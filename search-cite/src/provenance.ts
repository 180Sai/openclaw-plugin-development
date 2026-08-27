/**
 * Evidence-to-claim validation.
 *
 * This is the heart of grounding. A Citation is only valid when:
 *  1. its URL appears in the provider's returned result set (came from search),
 *  2. that URL was successfully fetched (redirect-resolved final URL),
 *  3. its `quote` is a verbatim substring of the fetched document text.
 *
 * Violations produce structured errors and set `grounded: false` rather than
 * emitting an unverified link.
 */

import type { Citation, FetchedDocument, SearchResult } from "./types.js";

export interface ProvenanceError {
  url: string;
  reason: string;
}

/** Check a proposed citation against provenance facts. */
export function validateQuote(
  citation: Omit<Citation, "retrievedAt">,
  docsByUrl: Map<string, FetchedDocument>,
  resultUrls: Set<string>,
): ProvenanceError | null {
  if (!resultUrls.has(citation.url)) {
    return { url: citation.url, reason: "url was not returned by the search provider" };
  }
  const doc = docsByUrl.get(citation.url);
  if (!doc) {
    return { url: citation.url, reason: "url was never fetched" };
  }
  if (!doc.text.includes(citation.quote.toLowerCase())) {
    return { url: citation.url, reason: "quote is not present in the fetched document text" };
  }
  return null;
}

/** Validate a full list of citations; returns errors, empty when all pass. */
export function validateCitations(
  citations: Omit<Citation, "retrievedAt">[],
  docsByUrl: Map<string, FetchedDocument>,
  results: SearchResult[],
): ProvenanceError[] {
  const resultUrls = new Set(results.map((r) => r.url));
  const errors: ProvenanceError[] = [];
  for (const c of citations) {
    const err = validateQuote(c, docsByUrl, resultUrls);
    if (err) errors.push(err);
  }
  return errors;
}
