/**
 * Eval fixture: canonical-URL dedupe before fetch.
 *
 * A provider may return the same page under several URL variants —
 * tracking params (utm_*), a fragment, or a trailing slash. The pipeline
 * must treat them as ONE source: fetch and cite the page once, and keep
 * the first returned URL so provenance (URL ∈ provider result set, was
 * fetched) stays intact.
 *
 * Used by evals/run.mjs.
 */
export const urlVariantResults = {
  url: "https://example.com/guide",
  title: "Example Guide",
  /** Provider returns four variants of the same page, first is canonical. */
  searchResults: [
    {
      url: "https://example.com/guide",
      title: "Example Guide",
      snippet: "official guide for grounded search",
      score: 0.95,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://example.com/guide?utm_source=ddg&utm_medium=organic",
      title: "Example Guide",
      snippet: "official guide for grounded search",
      score: 0.9,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://example.com/guide/#overview",
      title: "Example Guide",
      snippet: "official guide for grounded search",
      score: 0.85,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://example.com/guide?utm_campaign=launch",
      title: "Example Guide",
      snippet: "official guide for grounded search",
      score: 0.8,
      retrievedAt: new Date().toISOString(),
    },
  ],
  /** After dedupe, exactly the canonical URL must be fetched and cited. */
  expectedUrl: "https://example.com/guide",
  expectedCitationCount: 1,
};