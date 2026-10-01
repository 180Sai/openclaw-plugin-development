/**
 * Eval fixture: trailing '?' with no query params collapses in dedupe.
 *
 * A provider may return the same page with a bare trailing '?'
 * (e.g. from a CMS that always appends '?') and without it.
 * These must collapse to one citation.
 *
 * Used by evals/run.mjs.
 */
export const urlEmptyQueryResults = {
  url: "https://example.com/release-notes",
  title: "Release Notes",
  /** Provider returns the same page with and without a trailing '?'. */
  searchResults: [
    {
      url: "https://example.com/release-notes?",
      title: "Release Notes",
      snippet: "versioned feature summaries for the current upstream release",
      score: 0.95,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://example.com/release-notes",
      title: "Release Notes",
      snippet: "versioned feature summaries for the current upstream release",
      score: 0.9,
      retrievedAt: new Date().toISOString(),
    },
  ],
  /** After dedupe, exactly the canonical URL (no trailing '?') must be fetched and cited. */
  expectedUrl: "https://example.com/release-notes",
  expectedCitationCount: 1,
};
