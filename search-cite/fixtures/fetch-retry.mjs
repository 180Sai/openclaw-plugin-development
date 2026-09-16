/**
 * Eval fixture: transient-failure retry policy.
 *
 * The HttpFetcher retries transient conditions (429, 5xx, network errors)
 * with bounded backoff and never retries permanent ones (4xx client errors,
 * abort timeouts, unsupported content types) — so a flaky server does not
 * break grounding while a truly bad URL fails fast.
 *
 * Used by tests/fetch-retry.test.ts and evals/run.mjs.
 */
export const retryFixture = {
  url: "https://example.com/flaky",
  /** Server recovers on the 3rd attempt. */
  failWith: 503,
  succeedOnAttempt: 3,
  /** Permanent statuses that must NOT be retried. */
  permanent: [404, 403],
  transient: [429, 500, 503],
  maxRetries: 2,
};