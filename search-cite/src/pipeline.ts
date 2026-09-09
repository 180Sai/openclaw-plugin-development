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
import { selectSources, scoreDocument } from "./scoring.js";
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
  const results: SearchResult[] = await deps.provider.search(params.query, { maxResults: max });

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

  // Build citations as verbatim snippets from the fetched texts.
  const citations: Omit<Citation, "retrievedAt">[] = selected.map((d) => {
    const sentence = firstSentence(d.text) || d.text.slice(0, 160);
    return { url: d.url, title: d.title, quote: sentence };
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

function summarize(query: string, docs: FetchedDocument[]): string {
  const lines = docs.map((d) => `- ${d.title} (${d.url})`);
  return `Grounded results for "${query}":\n${lines.join("\n")}\n\nEach citation below links to a page that was fetched; quotes are verbatim from that page.`;
}

/** Re-export for scoring consistency in the tool entry. */
export function trustScore(doc: FetchedDocument, minTrust: number): number {
  return scoreDocument(doc, { minTrust });
}
