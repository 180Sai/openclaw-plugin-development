/**
 * Eval fixture: bounded-concurrency fetching.
 *
 * The pipeline must fetch multiple provider results concurrently (not serially
 * stalled on one slow host) while bounding in-flight requests so a burst of
 * results never opens unbounded connections. Input order must be preserved,
 * and per-URL failures must be collected rather than aborting the run.
 *
 * Used by tests/pipeline.test.ts and evals/run.mjs.
 */
export const concurrencyFixture = {
  urls: [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
  ],
  /** Concurrency cap the pipeline default must respect. */
  limit: 2,
  /** Docs must come back in this order regardless of fetch completion order. */
  expectedOrder: ["a", "b", "c"],
  /** The third URL fails; its error must be surfaced, not fatal. */
  failingUrl: "https://example.com/c",
  texts: {
    "https://example.com/a": "alpha document text for grounding.",
    "https://example.com/b": "bravo document text for grounding.",
  },
};