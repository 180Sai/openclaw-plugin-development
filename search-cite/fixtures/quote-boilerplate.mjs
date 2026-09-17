/**
 * Eval fixture: quote selection avoids page-top boilerplate.
 *
 * Verifies that selectQuote() prefers an informative body sentence
 * over page-chrome/nav text at the top of the document. Also covers
 * the empty-title fallback (title is blank in the fixture HTML).
 *
 * Used by evals/run.mjs.
 */
export const boilerplateQuoteContent = {
  url: "https://example.com/docs/grounding-guide",
  title: "",
  html: `<!DOCTYPE html><html><head><title></title></head><body>
<nav><a href="#main">Skip to content</a> <a href="/">Home</a> <a href="/news">News</a></nav>
<header>Search this site</header>
<main><p>Grounding evidence must come from a page the tool actually fetched and parsed end to end.</p></main>
<footer>All rights reserved. Privacy policy. Terms of service.</footer>
</body></html>`,
  /** The text as the fetcher would produce (lowercased, whitespace-normalized). */
  normalizedText:
    "skip to content home news search this site. grounding evidence must come from a page the tool actually fetched and parsed end to end. all rights reserved privacy policy terms of service.",
  query: "grounding evidence",
  term: "grounding",
  /** The selected quote must include the body sentence and exclude boilerplate. */
  forbidden: ["skip to content", "search this site", "all rights reserved"],
};
