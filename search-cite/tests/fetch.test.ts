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

  it("does not alter title extraction (raw title preserved)", () => {
    // extractTitle is entity-agnostic by design: titles are cosmetic and not
    // part of the quote-substring grounding contract.
    expect(extractTitle("<html><head><title>Caf\u00e9 &amp; Co</title></head></html>")).toBe("Café &amp; Co");
  });
});