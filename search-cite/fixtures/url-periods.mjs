/**
 * Grounding evaluation fixture: page with URL-containing text.
 *
 * Verifies that firstSentence() does NOT truncate at periods inside URLs
 * (e.g. "example.com" → the period between "example" and "com" is not a
 * sentence boundary).
 *
 * Used by tests/pipeline.test.ts and evals/run.mjs.
 */
export const fixtureUrlContent = {
  url: "https://example.com/article",
  title: "Test Article",
  html: `<!DOCTYPE html><html><head><title>Test Article</title></head><body>
<p>Visit example.com for more details about grounding. This is the second sentence.</p>
</body></html>`,
  /** The text after extractText + lowercasing (as the fetcher would produce). */
  normalizedText:
    "test article visit example.com for more details about grounding. this is the second sentence.",
  /** The first sentence that firstSentence() should extract (includes title text). */
  expectedFirstSentence:
    "test article visit example.com for more details about grounding.",
};