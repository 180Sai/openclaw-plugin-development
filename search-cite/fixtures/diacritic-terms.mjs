/**
 * Eval fixture: query-term matching is diacritic-insensitive.
 *
 * A query written without an accent ("cafe") must match document text that
 * spells the word with an accent ("café"), and an accented query must match
 * an ASCII-only document rendering. Matching folds both sides (NFD +
 * strip combining marks) purely for *relevance scoring and windowing*; the
 * emitted quote is always sliced verbatim from the original document text,
 * so provenance (quote ∈ fetched text) is never broken by the fold.
 *
 * This document contains the target term only in the accented form "café"
 * (plus a decoy "cafeteria" that must NOT be chosen). The quote must come
 * from the sentence containing "café", not "cafeteria". Even though the
 * query term is the unaccented "cafe", the returned quote must still carry
 * the verbatim accent "café".
 *
 * Used by evals/run.mjs.
 */
export const diacriticTermContent = {
  url: "https://example.com/diacritic-terms",
  title: "Diacritic Term Matching",
  html: `<!DOCTYPE html><html><head><title>Diacritic Term Matching</title></head><body>
<p>The caf&eacute; is the best spot in the district for fresh grounds.</p>
<p>Neither the cafeteria nor its staff knew the exact menu sizes.</p>
<p>Opening times and the full menu are posted at the front counter.</p>
</body></html>`,
  /** The text as the fetcher would produce (lowercased, entities decoded, whitespace-normalized). */
  normalizedText:
    "the café is the best spot in the district for fresh grounds. neither the cafeteria nor its staff knew the exact menu sizes. opening times and the full menu are posted at the front counter.",
  /** Query written without the accent; must still match the accented text. */
  query: "cafe",
  /** The accented term the folding should surface, verbatim, in the quote. */
  term: "café",
  /** The selected quote must come from the "café" sentence, never "cafeteria". */
  forbidden: ["cafeteria"],
};