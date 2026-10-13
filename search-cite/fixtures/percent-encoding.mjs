/**
 * Eval fixture: percent-encoding variants collapse in canonical dedupe.
 *
 * A provider may return the same page with the same path spelled with
 * different percent-encodings: hex-digit case differs ("%C3%A9" vs
 * "%c3%a9") or an unreserved character is over-encoded ("%7E" is the
 * RFC 3986 over-encoding of "~", and URL parsers keep the encoded form as
 * given). All of these address the same resource and must collapse to one
 * citation instead of citing the same page twice. Encoded reserved
 * characters ("a%2Fb" vs "a/b") remain distinct — a literal slash is a path
 * separator, an encoded one is a character inside a single segment (checked
 * in evals/run.mjs).
 *
 * Used by evals/run.mjs.
 */
export const percentEncodingResults = {
  url: "https://example.com/docs/~user/caf%C3%A9-guide",
  title: "Café Guide",
  /** Provider returns the same page with spelled-differently encoded paths. */
  searchResults: [
    {
      url: "https://example.com/docs/~user/caf%C3%A9-guide?tab=config&view=full",
      title: "Café Guide",
      snippet: "café guide with grounded setup detail and verifiable evidence",
      score: 0.95,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://example.com/docs/%7Euser/caf%c3%a9-guide?view=full&tab=config",
      title: "Café Guide",
      snippet: "café guide with grounded setup detail and verifiable evidence",
      score: 0.9,
      retrievedAt: new Date().toISOString(),
    },
    {
      url: "https://example.com/docs/%7euser/caf%C3%A9-guide?tab=config",
      title: "Café Guide",
      snippet: "café guide with grounded setup detail and verifiable evidence",
      score: 0.85,
      retrievedAt: new Date().toISOString(),
    },
  ],
  /** After dedupe, exactly one citation (the first-returned URL) is fetched. */
  expectedUrl: "https://example.com/docs/~user/caf%C3%A9-guide?tab=config&view=full",
  expectedCitationCount: 1,
};