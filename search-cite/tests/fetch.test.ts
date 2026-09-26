import { describe, it, expect } from "vitest";
import { extractText, extractTitle, decodeEntities } from "../src/fetch.js";
import { entityFixture } from "../fixtures/entity-decoding.mjs";

describe("extractText HTML entity decoding", () => {
  it("decodes named and numeric entities in page text", () => {
    const text = extractText(entityFixture.html).toLowerCase();
    expect(text).toBe(entityFixture.normalizedText);
  });

  it("never leaks raw entities into extracted text", () => {
    const text = extractText("<p>&amp; &lt; &gt; &#65;</p>");
    expect(text.includes("&amp;")).toBe(false);
    expect(text.includes("&lt;")).toBe(false);
    expect(text.includes("&gt;")).toBe(false);
    expect(text).toBe("& < > A"); // &#65; = 'A'
  });

  it("normalizes non-breaking spaces to regular spaces", () => {
    expect(extractText("<p>a\u00a0b</p>")).toBe("a b");
    expect(extractText("&nbsp;leading")).toBe("leading");
  });

  it("leaves unknown entities untouched", () => {
    expect(decodeEntities("a &unknown; b")).toBe("a &unknown; b");
  });

  it("decodes named entities in the title like extractText does for text", () => {
    expect(extractTitle("<html><head><title>Caf\u00e9 &amp; Co</title></head></html>")).toBe("Café & Co");
  });

  it("decodes HTML entities in the extracted title so they never leak to users", () => {
    expect(extractTitle(entityFixture.titleHtml)).toBe(entityFixture.decodedTitle);
  });

  it("decodes a bare UTF-8 title unchanged and collapses whitespace", () => {
    expect(extractTitle("<title>A  B\n C</title>")).toBe("A B C");
  });

  it("collapses whitespace AFTER decoding, so nbsp entities don't leak double spaces", () => {
    // decodeEntities maps &nbsp; to a literal space; decoding before the
    // whitespace collapse (same order as extractText) keeps the title clean.
    expect(extractTitle("<title>A&nbsp;&nbsp;B</title>")).toBe("A B");
    expect(extractTitle("<title>A&#160; B</title>")).toBe("A B");
  });

  it("returns null when no title element exists", () => {
    expect(extractTitle("<html><body><p>no title here</p></body></html>")).toBeNull();
  });
});