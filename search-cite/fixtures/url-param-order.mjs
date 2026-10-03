/**
 * Eval fixture: reordered query-parameter variants collapse in dedupe.
 *
 * A provider may return the same page with the same query parameters in
 * different orders ("?a=1&b=2" vs "?b=2&a=1"). Parameter-map semantics are
 * order-independent, so these address the same page and must collapse to
 * one citation instead of citing the same resource twice.
 *
 * Used by evals/run.mjs.
 */
export const urlParamOrderResults = {
  url: "https://example.com/runtime-notes",
  title: "Runtime Notes",
  /** Provider returns the same page with reordered query params. */
  searchResults: [
    {
      url: "https://example.com/runtime-notes?tab=config&view=full",
      title: "Runtime Notes",
      snippet: "runtime configuration notes with grounded detail and evidence",
      score: 0.95,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://example.com/runtime-notes?view=full&tab=config",
      title: "Runtime Notes",
      snippet: "runtime configuration notes with grounded detail and evidence",
      score: 0.9,
      retrievedAt: new Date().toISOString(),
    },
  ],
  /** After dedupe, exactly one citation (the first-returned URL) must be fetched. */
  expectedUrl: "https://example.com/runtime-notes?tab=config&view=full",
  expectedCitationCount: 1,
};