/**
 * Eval fixture: duplicate provider results.
 *
 * A well-behaved provider should never return the same URL twice, but the
 * pipeline must be defense-in-depth: duplicate URLs must be deduped BEFORE
 * fetch so a page is never fetched (or cited) twice.
 *
 * Used by tests/pipeline.test.ts and evals/run.mjs.
 */
export const duplicateResults = {
  url: "https://example.com/guide",
  title: "Example Guide",
  snippet: "duplicate result",
  score: 0.9,
  /** A provider that returns the same URL twice (worst-case behavior). */
  searchResults: [
    {
      url: "https://example.com/guide",
      title: "Example Guide",
      snippet: "duplicate result",
      score: 0.9,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://example.com/guide",
      title: "Example Guide",
      snippet: "duplicate result",
      score: 0.9,
      retrievedAt: new Date().toISOString(),
    },
  ],
};