/**
 * Eval fixture: trailing-dot FQDN hostnames collapse in canonical dedupe.
 *
 * A hostname may be written with a trailing dot ("example.com."), the
 * root-marker of a fully qualified domain name. Per RFC 4343 the trailing
 * dot is insignificant and both spellings resolve to the same host.
 * Providers occasionally return the FQDN form, which would otherwise split
 * one page into two citations.
 *
 * Used by evals/run.mjs.
 */
export const trailingDotResults = {
  url: "https://example.com/docs/guide",
  title: "Setup Guide",
  /** Provider returns the same page, some results with a trailing-dot host. */
  searchResults: [
    {
      url: "https://example.com/docs/guide?tab=config&view=full",
      title: "Setup Guide",
      snippet: "setup guide with grounded configuration detail and verifiable evidence",
      score: 0.95,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://example.com./docs/guide?view=full&tab=config",
      title: "Setup Guide",
      snippet: "setup guide with grounded configuration detail and verifiable evidence",
      score: 0.9,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://www.example.com./docs/guide?utm_source=x",
      title: "Setup Guide",
      snippet: "setup guide with grounded configuration detail and verifiable evidence",
      score: 0.85,
      retrievedAt: new Date().toISOString(),
    },
  ],
  /** After dedupe, exactly one citation (the first-returned URL) is fetched. */
  expectedUrl: "https://example.com/docs/guide?tab=config&view=full",
  expectedCitationCount: 1,
};