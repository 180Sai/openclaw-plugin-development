/**
 * Eval fixture: HTML entity decoding in extracted text.
 *
 * Pages frequently contain HTML entities (&amp;, &lt;, numeric codepoints).
 * If they leak into extracted text, the grounding invariant breaks: a
 * user-facing quote ("Fish & Chips") would no longer be a verbatim substring
 * of the extracted text, or raw entities would appear inside citations.
 *
 * Used by tests/fetch.test.ts and evals/run.mjs.
 */
export const entityFixture = {
  url: "https://example.com/entity-page",
  title: "Entity Article",
  html: `<!DOCTYPE html><html><head><title>Entity Article</title></head><body>
<p>Fish &amp; Chips cost 5&#8364;.</p>
<p>Tom &amp; Jerry &#x2022; Caf&#233; &lt;3 &nbsp; grounding</p>
</body></html>`,
  /** The text after extractText + lowercasing (as the fetcher would produce). */
  normalizedText: "entity article fish & chips cost 5€. tom & jerry • café <3 grounding",
  /** An HTML fragment whose <title> contains raw entities. */
  titleHtml: `<html><head><title>Caf&#233; &amp; Co &#8212; Guide</title></head></html>`,
  /** titleHtml decoded: entities resolved, whitespace collapsed. */
  decodedTitle: "Café & Co — Guide",
  /** Same title but via NAMED entities — the PR's motivating example. */
  namedTitleHtml: `<html><head><title>Caf&eacute; &amp; Co &mdash; Guide</title></head></html>`,
  /** namedTitleHtml decoded: named Latin-1/typographic entities resolved. */
  namedDecodedTitle: "Café & Co — Guide",
};