/**
 * Eval fixture: query-term matching treats non-ASCII letters as word
 * characters.
 *
 * Two regressions covered:
 *
 * 1. Boundary matching: the old ASCII-only boundary regex `[a-z0-9]` let a
 *    term match inside words where it was followed/preceded by an accented
 *    letter — "art" matched inside "artículo" because "í" is not `[a-z0-9]`.
 *    This document contains "art" as a real word only in the last sentence;
 *    the quote must come from there, never from "artículo".
 *
 * 2. Term extraction: the old ASCII-only splitter `[^a-z0-9]+` chopped
 *    accented terms — a query "café" produced the term "caf". The query-level
 *    extraction check below asserts the accent survives.
 *
 * Used by evals/run.mjs.
 */
export const unicodeTermContent = {
  url: "https://example.com/unicode-terms",
  title: "Unicode Term Matching",
  html: `<!DOCTYPE html><html><head><title>Unicode Term Matching</title></head><body>
<p>El art&iacute;culo sobre cultura moderna.</p>
<p>Art matters most of all in this overview of the movement.</p>
</body></html>`,
  /** The text as the fetcher would produce (lowercased, entities decoded, whitespace-normalized). */
  normalizedText:
    "el artículo sobre cultura moderna. art matters most of all in this overview of the movement.",
  query: "art",
  term: "art",
  /** The selected quote must come from the real-word sentence. */
  forbidden: ["artículo"],
};