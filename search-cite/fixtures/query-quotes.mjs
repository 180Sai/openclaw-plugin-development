/**
 * Eval fixture: query-relevant quote selection.
 *
 * Verifies that selectQuote() picks a passage containing a significant query
 * term rather than always returning the document's first sentence, and that
 * the chosen quote is always a verbatim substring of the source text.
 *
 * Used by tests/pipeline.test.ts and evals/run.mjs.
 */
export const queryQuoteContent = {
  url: "https://example.com/grounding-article",
  title: "Grounding Article",
  html: `<!DOCTYPE html><html><head><title>Grounding Article</title></head><body>
<p>A generic introduction with nothing useful for the query.</p>
<p>Later the article finally discusses grounding with verifiable evidence and primary sources.</p>
</body></html>`,
  /** The text as the fetcher would produce (lowercased, whitespace-normalized). */
  normalizedText:
    "grounding article a generic introduction with nothing useful for the query. later the article finally discusses grounding with verifiable evidence and primary sources.",
  /** A query whose significant term appears only in the second paragraph. */
  query: "grounding",
  /** The term the selected quote must contain. */
  term: "grounding",
};