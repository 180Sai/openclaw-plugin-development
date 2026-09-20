/**
 * Eval fixture: query-term matching respects word boundaries.
 *
 * Without word-boundary matching, a short term like "art" spuriously matches
 * inside unrelated words ("startup", "article"), skewing quote-relevance
 * scoring toward page-top noise. This fixture's document contains the term
 * "art" as a real word only in the last sentence; the quote must come from
 * there, never from a sentence that merely contains "art" as a substring.
 *
 * Used by evals/run.mjs.
 */
export const wordBoundaryContent = {
  url: "https://example.com/art-overview",
  title: "Art Overview",
  html: `<!DOCTYPE html><html><head><title>Art Overview</title></head><body>
<p>The startup guide begins now.</p>
<p>This article has many words.</p>
<p>Art matters most of all here.</p>
</body></html>`,
  /** The text as the fetcher would produce (lowercased, whitespace-normalized). */
  normalizedText:
    "the startup guide begins now. this article has many words. art matters most of all here.",
  query: "art",
  term: "art",
  /** The selected quote must come from the real-word sentence. */
  forbidden: ["startup", "article"],
};