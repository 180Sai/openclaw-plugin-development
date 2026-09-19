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
  /** 429 responses may carry Retry-After: delay-seconds or HTTP-date; honored, capped at 5s. */
  retryAfter: {
    parseSeconds: 1,
    parsedMs: 1000,
    capMs: 5000,
    httpDateFutureDeltaMs: 2000,
    httpDatePast: undefined,
  },
  /** Exponential backoff fallback carries ±20% jitter (thundering-herd avoidance). */
  jitter: { bounds: [0.8, 1.2], baseMs: 250, attempt2NoJitterMs: 1000, attempt2LowMs: 800, attempt2HighMs: 1200 },
};