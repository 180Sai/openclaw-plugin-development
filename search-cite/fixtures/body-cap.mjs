/**
 * Eval fixture: response-body size cap in HttpFetcher.
 *
 * The fetcher must never read unbounded bodies: a server may declare an
 * oversized Content-Length, or omit/lie about it. Oversized responses are
 * rejected as permanent (never retried) errors — never truncated, because
 * truncation would break the quote-substring grounding invariant.
 *
 * Used by tests/fetch-body-cap.test.ts and evals/run.mjs.
 */
export const bodyCapFixture = {
  capBytes: 1000,
  oversized: {
    declaredLength: "999999",
    /** Post-read enforcement: no Content-Length, huge body. */
    undeclaredBodyChars: 5000,
    permanentMsg: /response body exceeds 1000-char cap/,
    declaredMsg: /content-length 999999 exceeds 1000-byte cap/,
  },
  underCap: { bodyChars: 100 },
};