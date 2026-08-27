/**
 * Shared types for the search-and-cite plugin.
 *
 * The central invariant: a Citation is only ever produced from a source that
 * the tool actually searched for and fetched. This file defines the data
 * shapes that encode that provenance.
 */

/** A resolved search result returned by a provider. */
export interface SearchResult {
  /** Canonical URL of the result. Must be a real, resolvable URL. */
  url: string;
  /** Page title from the provider (may be empty/unknown). */
  title: string;
  /** Provider-supplied snippet. Treated as untrusted, pre-fetch text. */
  snippet?: string;
  /** Optional provider confidence/rank score in [0,1]. */
  score?: number;
  /** ISO timestamp of when provider returned the result. */
  retrievedAt: string;
}

/** A successfully fetched page. */
export interface FetchedDocument {
  /** Final URL after redirects (canonical). */
  url: string;
  title: string;
  /** Plain-text content of the page, lowercased for matching. */
  text: string;
  /** ISO timestamp of the fetch. */
  fetchedAt: string;
}

/** A single grounded citation bound to evidence in a fetched document. */
export interface Citation {
  /** Canonical URL (must equal a fetched document's final URL). */
  url: string;
  title: string;
  /** ISO timestamp of retrieval. */
  retrievedAt: string;
  /**
   * Verbatim quote drawn from the fetched document's extracted text.
   * Enforced at runtime: this must be a substring of the source document text.
   */
  quote: string;
}

/** Result of the search_and_cite tool. */
export interface SearchAndCiteOutput {
  answer: string;
  /** False when grounding could not be established for a required claim. */
  grounded: boolean;
  citations: Citation[];
  /** Non-empty when grounding failed. */
  errors?: string[];
}

/** Provider contract. A provider performs a search and returns results. */
export interface SearchProvider {
  readonly id: string;
  search(query: string, opts: { maxResults: number }): Promise<SearchResult[]>;
}

/** Fetch contract: resolve a URL to text with redirect/error handling. */
export interface Fetcher {
  fetch(url: string): Promise<FetchedDocument>;
}

export interface SearchAndCiteConfig {
  provider: string;
  maxSources: number;
  minTrust: number;
}

export const DEFAULT_CONFIG: SearchAndCiteConfig = {
  provider: "mock",
  maxSources: 5,
  minTrust: 0.5,
};
