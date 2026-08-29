/**
 * Search provider implementations.
 *
 * At this first iteration we ship two providers:
 *  - `mock`: a deterministic, credential-free provider used by unit tests and
 *    the CI grounding evaluation. It "returns" a fixed set of results and a
 *    matching fetcher so the full search->fetch->cite pipeline can be proven
 *    without any external API key.
 *  - `http`: a pluggable HTTP provider skeleton. It performs a real search
 *    against a configurable endpoint and is where a Tavily/SerpAPI/Brave/Bing
 *    adapter should be filled in later (credentials stay in the host secrets
 *    store, never in Git).
 *
 * Grounding rule enforced by the CALLER (search.ts / index.ts): a citation URL
 * must come from this provider's returned results and then be fetched
 * successfully. Providers never fabricate URLs.
 */

import type { FetchedDocument, Fetcher, SearchProvider, SearchResult } from "./types.js";

const now = () => new Date().toISOString();

/** Deterministic mock provider with fixed, self-consistent results. */
export class MockSearchProvider implements SearchProvider {
  readonly id = "mock";
  private readonly corpus: { url: string; title: string; excerpt: string }[];

  constructor(corpus?: { url: string; title: string; excerpt: string }[]) {
    this.corpus =
      corpus ??
      [
        {
          url: "https://example.com/guide",
          title: "Example Guide",
          excerpt:
            "The official example guide explains how to configure grounded search and cite primary sources with verifiable evidence.",
        },
        {
          url: "https://example.com/faq",
          title: "Example FAQ",
          excerpt:
            "Frequently asked questions: grounding requires that every citation point to a page that was actually fetched and quoted.",
        },
      ];
  }

  async search(query: string, opts: { maxResults: number }): Promise<SearchResult[]> {
    const q = query.toLowerCase();
    const matched = this.corpus
      .filter((c) => c.title.toLowerCase().includes(q) || c.excerpt.toLowerCase().includes(q))
      .concat(this.corpus)
      .filter((c, i, arr) => arr.findIndex((x) => x.url === c.url) === i);
    return matched.slice(0, opts.maxResults).map((c) => ({
      url: c.url,
      title: c.title,
      snippet: c.excerpt,
      score: 0.9,
      retrievedAt: now(),
    }));
  }
}

/** Fetch adapter paired with the mock provider: returns its own known text. */
export class MockFetcher implements Fetcher {
  private readonly corpus = new Map<string, { title: string; text: string }>([
    [
      "https://example.com/guide",
      {
        title: "Example Guide",
        text: "The official example guide explains how to configure grounded search and cite primary sources with verifiable evidence.",
      },
    ],
    [
      "https://example.com/faq",
      {
        title: "Example FAQ",
        text: "Frequently asked questions about grounding require that every citation point to a page that was actually fetched and quoted.",
      },
    ],
  ]);

  async fetch(url: string): Promise<FetchedDocument> {
    const entry = this.corpus.get(url);
    if (!entry) {
      throw new Error(`mock fetcher: unknown url ${url}`);
    }
    // Match the HttpFetcher contract: `text` is normalized to lowercase so
    // quote-substring validation is consistent across providers.
    return { url, title: entry.title, text: entry.text.toLowerCase(), fetchedAt: now() };
  }
}

/** HTTP provider skeleton — real provider adapters should extend this. */
export class HttpSearchProvider implements SearchProvider {
  readonly id = "http";
  constructor(private readonly endpoint: string) {}

  async search(query: string, opts: { maxResults: number }): Promise<SearchResult[]> {
    // NOTE: fill in a real provider adapter here (Tavily/SerpAPI/Brave/Bing).
    // Keep the API key in the OpenClaw secrets store / env, never in Git.
    // Throw a clear error rather than returning fabricated results.
    throw new Error(
      `http provider not configured: set an endpoint and an adapter for query "${query}" (max=${opts.maxResults})`,
    );
  }
}
