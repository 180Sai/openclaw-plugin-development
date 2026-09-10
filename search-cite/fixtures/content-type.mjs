/**
 * Eval fixture: content-type filtering for citable pages.
 *
 * The Fetcher must never cite a binary payload (PDF, image, etc.) as if it
 * were text — reading such a body produces garbage extracted text that
 * cannot ground a real quote. Only text-ish media types are citable.
 *
 * Used by tests/fetch-content-type.test.ts and evals/run.mjs.
 */
export const contentTypeFixture = {
  url: "https://example.com/report.pdf",
  title: "Report PDF",
  /** A PDF-looking binary response (as fetch() would surface content-type). */
  contentType: "application/pdf; charset=binary",
  htmlPayload: null,
  expected: false,
};