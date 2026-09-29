/**
 * Eval fixture: canonical-URL dedupe collapses scheme (http/https) and
 * www-prefix variants of one page.
 *
 * A provider may return the same page under mixed http/https and with/without
 * a leading `www.`, plus tracking params. These address the same page, so the
 * pipeline must treat them as ONE source: fetch/cite once, keep the first
 * returned URL so provenance (URL ∈ provider result set, was fetched) stays
 * intact.
 *
 * Used by evals/run.mjs.
 */
export const urlSchemeVariantResults = {
  url: "https://example.com/release-notes",
  title: "Release Notes",
  /** Provider returns four variants of the same page; first is canonical. */
  searchResults: [
    {
      url: "https://example.com/release-notes",
      title: "Release Notes",
      snippet: "upstream release notes with versioned feature summaries",
      score: 0.95,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "http://example.com/release-notes",
      title: "Release Notes",
      snippet: "upstream release notes with versioned feature summaries",
      score: 0.9,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://www.example.com/release-notes",
      title: "Release Notes",
      snippet: "upstream release notes with versioned feature summaries",
      score: 0.85,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "http://www.example.com/release-notes?utm_source=ddg",
      title: "Release Notes",
      snippet: "upstream release notes with versioned feature summaries",
      score: 0.8,
      retrievedAt: new Date().toISOString(),
    },
  ],
  /** After dedupe, exactly the canonical URL must be fetched and cited. */
  expectedUrl: "https://example.com/release-notes",
  expectedCitationCount: 1,
};