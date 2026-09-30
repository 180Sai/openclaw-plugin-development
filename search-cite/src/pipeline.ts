/**
 * Pipeline orchestration: search -> fetch -> select -> cite -> validate.
 *
 * Produces a grounded answer with citations, OR a structured failure
 * (`grounded:false`) when provenance cannot be established for a required
 * claim. Never fabricates citations.
 */

import type {
  Citation,
  FetchedDocument,
  Fetcher,
  SearchAndCiteOutput,
  SearchProvider,
  SearchResult,
} from "./types.js";
import { dedupeByUrl, selectSources, scoreDocument } from "./scoring.js";
import { validateCitations } from "./provenance.js";

export interface PipelineDeps {
  provider: SearchProvider;
  fetcher: Fetcher;
  maxSources: number;
  minTrust: number;
  allowDomains?: string[];
  denyDomains?: string[];
}

export interface RunParams {
  query: string;
  maxSources?: number;
  requireGrounding?: boolean;
}

/**
 * Run the full pipeline and return a grounded output.
 *
 * `answer` is built ONLY from fetched evidence. When `requireGrounding` is true
 * and any claim cannot be grounded, we return `grounded:false` with the
 * structured errors and an empty citations array rather than an unverified
 * answer.
 */
export async function runSearchAndCite(
  deps: PipelineDeps,
  params: RunParams,
): Promise<SearchAndCiteOutput> {
  const max = Math.min(deps.maxSources, params.maxSources ?? deps.maxSources);
  // Deduplicate provider results before fetching so the same URL is never
  // fetched (or cited) twice, then enforce the source cap on unique URLs.
  const results: SearchResult[] = dedupeByUrl(
    await deps.provider.search(params.query, { maxResults: max }),
  ).slice(0, max);

  if (results.length === 0) {
    return {
      answer: `No search results found for "${params.query}".`,
      grounded: false,
      citations: [],
      errors: ["search returned no results"],
    };
  }

  // Fetch all returned results (top `max`) with bounded concurrency so a
  // slow host does not stall the whole run and a burst of results does not
  // open unbounded connections. Fetched docs keep provider order.
  const { docs, errors: fetchErrors } = await fetchWithConcurrency(
    results.map((r) => r.url),
    deps.fetcher,
  );

  // Select trustworthy docs above the trust threshold.
  const selected = selectSources(docs, { minTrust: deps.minTrust, allowDomains: deps.allowDomains, denyDomains: deps.denyDomains }, max);

  if (selected.length === 0) {
    return {
      answer: `Grounding could not be established for "${params.query}": no fetched source met the trust threshold.`,
      grounded: false,
      citations: [],
      errors: [...fetchErrors, "no sources passed the trust threshold"],
    };
  }

  // Build citations as verbatim snippets from the fetched texts. Prefer a
  // passage containing the query terms over the document's first sentence so
  // the quote actually supports the answer it is attached to.
  const citations: Omit<Citation, "retrievedAt">[] = selected.map((d) => {
    const quote = selectQuote(d.text, params.query);
    const title = d.title.trim() || fallbackTitle(d.url);
    return { url: d.url, title, quote };
  });

  // Validate provenance: every citation URL came from search and was fetched,
  // and every quote is a substring of its document.
  const docsByUrl = new Map(docs.map((d) => [d.url, d]));
  const errors = validateCitations(citations, docsByUrl, results);
  if (errors.length > 0) {
    return {
      answer: `Grounding could not be established for "${params.query}".`,
      grounded: false,
      citations: [],
      errors: [...fetchErrors, ...errors.map((e) => `${e.reason}: ${e.url}`)],
    };
  }

  const now = new Date().toISOString();
  return {
    answer: summarize(params.query, selected),
    grounded: true,
    citations: citations.map((c) => ({ ...c, retrievedAt: now })),
    errors: fetchErrors.length ? fetchErrors : undefined,
  };
}

/**
 * Fetch a list of URLs with bounded concurrency (default 4).
 *
 * Results preserve input order; per-URL failures are collected as error
 * strings and the failed slot is skipped (never fabricates a document). A
 * worker pulls the next index, so in-flight fetches never exceed `limit`.
 */
export async function fetchWithConcurrency(
  urls: string[],
  fetcher: Fetcher,
  limit = 4,
): Promise<{ docs: FetchedDocument[]; errors: string[] }> {
  if (limit < 1) limit = 1;
  const slots: (FetchedDocument | null)[] = new Array(urls.length).fill(null);
  const errors: string[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, urls.length) }, async () => {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i];
      try {
        slots[i] = await fetcher.fetch(url);
      } catch (e) {
        errors.push(`failed to fetch ${url}: ${(e as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
  return {
    docs: slots.filter((d): d is FetchedDocument => d !== null),
    errors,
  };
}

export function firstSentence(text: string): string {
  const idx = text.search(/[.!?](?=\s|$)/);
  if (idx === -1) return "";
  return text.slice(0, idx + 1).trim();
}

/**
 * Split text into sentences using the same boundary rule as
 * `firstSentence` — punctuation followed by whitespace or end-of-
 * string. This avoids splitting on periods inside URLs like
 * "example.com".
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  const re = /[.!?](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    sentences.push(text.slice(start, m.index + 1).trim());
    start = m.index + 1;
    while (start < text.length && /\s/.test(text[start])) start++;
  }
  if (start < text.length) {
    const tail = text.slice(start).trim();
    if (tail) sentences.push(tail);
  }
  return sentences;
}

/** Page-chrome / nav patterns that indicate boilerplate rather than
 *  informative content. Matched case-insensitively.
 */
const BOILERPLATE_PATTERNS = [
  /skip\s+to\s+(content|main|navigation)/i,
  /main\s+menu/i,
  /breadcrumb/i,
  /cookie\s+(notice|policy|consent|settings)/i,
  /accept\s+cookies/i,
  /subscribe/i,
  /newsletter/i,
  /sign\s+in/i,
  /log\s+in/i,
  /login/i,
  /register/i,
  /create\s+account/i,
  /back\s+to\s+top/i,
  /scroll\s+to\s+top/i,
  /all\s+rights\s+reserved/i,
  /privacy\s+policy/i,
  /terms\s+of\s+(use|service)/i,
  /powered\s+by/i,
  /advertisement/i,
  /sponsored/i,
  /table\s+of\s+contents/i,
  /jump\s+to/i,
  /share\s+this/i,
  /follow\s+us/i,
  /search\s+this\s+site/i,
  /search\s+the\s+site/i,
  /search\s+for:/i,
  /contact\s+us/i,
  /about\s+us/i,
];

function isBoilerplate(sentence: string): boolean {
  return BOILERPLATE_PATTERNS.some((p) => p.test(sentence));
}

/**
 * Score a candidate sentence for quote relevance.
 *
 * Rewards: query-term coverage (+4 per distinct term), informative
 * length (+2 for 80–400 chars), terminal punctuation (+1).
 * Penalises: boilerplate markers (−5), very-start-of-document
 * position (−2 when start offset < 300 chars).
 */
function scoreSentence(sentence: string, terms: string[], offset: number): number {
  let score = 0;
  const lower = sentence.toLowerCase();
  for (const t of terms) {
    if (containsTerm(lower, t)) score += 4;
  }
  if (sentence.length >= 80 && sentence.length <= 400) score += 2;
  if (/[.!?]$/.test(sentence)) score += 1;
  if (isBoilerplate(sentence)) score -= 5;
  if (offset < 300) score -= 2;
  return score;
}

/** Stopwords dropped when extracting significant query terms. */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "with",
  "at", "by", "is", "are", "was", "were", "be", "how", "what", "why",
  "when", "where", "does", "do", "not", "it", "its", "this", "that",
]);

/**
 * Extract lowercased, non-stopword terms from a query. Terms shorter than 3
 * chars are dropped so single letters cannot match inside unrelated words.
 *
 * Splitting is Unicode-aware (`\p{L}\p{N}`) so accented query words survive
 * intact: an ASCII-only splitter would turn "café" into the truncated term
 * "caf", which then matches inside unrelated words like "cafeteria".
 */
export function significantTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Unicode accent folding for matching.
 *
 * Normalizes a string to NFD then strips combining marks, so "café" folds to
 * "cafe". Used ONLY for relevance matching — never for the emitted quote,
 * which is always sliced verbatim from the original document text so
 * provenance (quote ∈ fetched text) is preserved.
 */
function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Escape regex metacharacters in a term used inside a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary-aware term matching.
 *
 * Query terms are alphanumeric; a term must be delimited by non-alphanumeric
 * characters (or the string edges) to count. Without this, a short term like
 * "art" spuriously matches inside unrelated words ("article", "starting"),
 * skewing quote-relevance scoring and windowing the quote around the wrong
 * text. Hyphens and periods are boundaries, so "node" still matches inside
 * "node-runtime" and "node.js".
 *
 * Boundaries are Unicode-aware (`\p{L}\p{N}`): an ASCII-only boundary would
 * treat the accented letter in "artículo" as a non-word char, letting "art"
 * spuriously match inside it. Terms are also matched accent-insensitively
 * (both the text and the term are diacritic-folded), so a query written
 * without accents ("cafe") matches document text that spells it "café", and
 * a query with accents matches an ASCII-only rendering. The backslashes are
 * doubled because this is a template literal: `\p` would collapse to a
 * literal "p" before the regex compiles.
 */
function containsTerm(text: string, term: string): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(foldDiacritics(term))}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(foldDiacritics(text));
}

/** Index of the first word-boundary occurrence of `term` in `text`, or -1. */
function findTermIndex(text: string, term: string): number {
  const m = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(foldDiacritics(term))}(?![\\p{L}\\p{N}])`,
    "u",
  ).exec(foldDiacritics(text));
  return m ? m.index : -1;
}

/**
 * Pick a verbatim quote from `text` that is informative and
 * query-relevant, preferring body content over page chrome/nav text.
 *
 * The text is split into sentences; each sentence is scored for
 * query-term coverage, informative length, and boilerplate
 * contamination. The highest-scoring sentence is returned as the
 * quote (windowed to `maxLen` at word boundaries around the first
 * matching term). Falls back to `firstSentence` when no sentence
 * contains a query term, preserving existing behaviour for
 * irrelevant pages. Never truncates inside a word and never
 * manufactures text.
 */
export function selectQuote(text: string, query: string, maxLen = 220): string {
  const terms = significantTerms(query);
  const sentences = splitSentences(text);

  let bestIdx = -1;
  let bestScore = -Infinity;
  let runningOffset = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const score = scoreSentence(s, terms, runningOffset);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
    runningOffset += s.length + 1; // +1 for the delimiter
  }

  if (bestIdx === -1 || sentences.length === 0) {
    return firstSentence(text) || text.slice(0, 160);
  }

  const best = sentences[bestIdx];

  // If the best sentence contains a significant term, extract a
  // window around the first such occurrence, scoped to the
  // sentence so we never cross into unrelated content.
  if (terms.length > 0) {
    const lower = best.toLowerCase();
    let idx = -1;
    for (const t of terms) {
      const i = findTermIndex(lower, t);
      if (i !== -1 && (idx === -1 || i < idx)) idx = i;
    }
    if (idx !== -1) {
      let s = Math.max(0, idx - 40);
      while (s > 0 && !/\s/.test(best[s - 1])) s -= 1;
      let e = Math.min(best.length, s + maxLen);
      while (e < best.length && !/\s/.test(best[e])) e += 1;
      const quote = best.slice(s, e).trim();
      if (quote.length > 0) return quote;
    }
  }

  // No term in the best sentence — return the sentence itself
  // (trimmed to maxLen at word boundary).
  if (best.length <= maxLen) return best;
  let s = 0;
  let e = Math.min(best.length, maxLen);
  while (e < best.length && !/\s/.test(best[e])) e += 1;
  return best.slice(s, e).trim();
}

/**
 * Derive a human-readable title from a URL path segment when the
 * fetched document has no title. Returns a non-empty string.
 */
export function fallbackTitle(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && last.length >= 2) {
      return last
        .replace(/\.(html?|php|aspx?|jsp|json|xml)$/i, "")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } catch {
    // not a valid URL
  }
  return "Source";
}

function summarize(query: string, docs: FetchedDocument[]): string {
  const lines = docs.map((d) => `- ${d.title} (${d.url})`);
  return `Grounded results for "${query}":\n${lines.join("\n")}\n\nEach citation below links to a page that was fetched; quotes are verbatim from that page.`;
}

/** Re-export for scoring consistency in the tool entry. */
export function trustScore(doc: FetchedDocument, minTrust: number): number {
  return scoreDocument(doc, { minTrust });
}
