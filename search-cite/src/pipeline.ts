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

  // Fetch all returned results (top `max`).
  const docs: FetchedDocument[] = [];
  const fetchErrors: string[] = [];
  for (const r of results) {
    try {
      docs.push(await deps.fetcher.fetch(r.url));
    } catch (e) {
      fetchErrors.push(`failed to fetch ${r.url}: ${(e as Error).message}`);
    }
  }

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
    return { url: d.url, title: d.title, quote };
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

export function firstSentence(text: string): string {
  const idx = text.search(/[.!?](?=\s|$)/);
  if (idx === -1) return "";
  return text.slice(0, idx + 1).trim();
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
 */
export function significantTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Pick a verbatim quote from `text` that contains a significant query term.
 *
 * The window (max `maxLen` chars) is centered on the earliest term occurrence
 * and snapped to word boundaries, so the result is always a substring of
 * `text`. Falls back to `firstSentence` when no term appears in the text, so
 * existing behavior is preserved for irrelevant pages. Never truncates inside
 * a word and never manufactures text.
 */
export function selectQuote(text: string, query: string, maxLen = 220): string {
  const terms = significantTerms(query);
  if (terms.length > 0) {
    let idx = -1;
    for (const t of terms) {
      const i = text.indexOf(t);
      if (i !== -1 && (idx === -1 || i < idx)) idx = i;
    }
    if (idx !== -1) {
      let s = Math.max(0, idx - 40);
      while (s > 0 && !/\s/.test(text[s - 1])) s -= 1;
      let e = Math.min(text.length, s + maxLen);
      while (e < text.length && !/\s/.test(text[e])) e += 1;
      const quote = text.slice(s, e).trim();
      if (quote.length > 0) return quote;
    }
  }
  return firstSentence(text) || text.slice(0, 160);
}

function summarize(query: string, docs: FetchedDocument[]): string {
  const lines = docs.map((d) => `- ${d.title} (${d.url})`);
  return `Grounded results for "${query}":\n${lines.join("\n")}\n\nEach citation below links to a page that was fetched; quotes are verbatim from that page.`;
}

/** Re-export for scoring consistency in the tool entry. */
export function trustScore(doc: FetchedDocument, minTrust: number): number {
  return scoreDocument(doc, { minTrust });
}
