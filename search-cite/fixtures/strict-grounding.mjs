/**
 * Eval fixture: strict grounding mode (requireGrounding=true).
 *
 * When the caller requires grounding and the result is not grounded, the
 * tool must return a structured failure only (grounded:false, empty
 * citations, errors) — never a prose answer that could be mistaken for a
 * verified claim.
 *
 * Used by tests/pipeline.test.ts and evals/run.mjs.
 */
export const strictGroundingFixture = {
  url: "https://example.com/strict-mode",
  title: "Strict Grounding Mode",
  /** A provider returning nothing forces the no-results failure path. */
  emptyResults: [],
  /** The structured failure the tool layer must produce. */
  expectedFailureShape: {
    grounded: false,
    citations: [],
    errors: ["search returned no results"],
  },
};