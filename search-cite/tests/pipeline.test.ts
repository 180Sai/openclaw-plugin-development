import { describe, it, expect } from "vitest";
import { MockSearchProvider, MockFetcher } from "../src/search.js";
import { runSearchAndCite, firstSentence, selectQuote, significantTerms, fetchWithConcurrency, splitSentences, fallbackTitle } from "../src/pipeline.js";
import { validateCitations } from "../src/provenance.js";
import { scoreDocument, selectSources, dedupeByUrl, canonicalUrlKey } from "../src/scoring.js";
import { extractText } from "../src/fetch.js";
import { OpenClawWebSearchProvider, extractResultsFromWebSearchOutput } from "../src/openclaw-search.js";
import type { FetchedDocument, SearchResult } from "../src/types.js";
import type { Fetcher } from "../src/types.js";
import { fixtureUrlContent } from "../fixtures/url-periods.mjs";
import { strictGroundingFixture } from "../fixtures/strict-grounding.mjs";

function deps() {
  return {
    provider: new MockSearchProvider(),
    fetcher: new MockFetcher(),
    maxSources: 5,
    minTrust: 0.5,
  };
}

describe("search_and_cite pipeline", () => {
  it("returns grounded citations for a matching query", async () => {
    const out = await runSearchAndCite(deps(), { query: "grounded" });
    expect(out.grounded).toBe(true);
    expect(out.citations.length).toBeGreaterThan(0);
    for (const c of out.citations) {
      expect(c.url).toMatch(/^https:\/\//);
      expect(c.quote.length).toBeGreaterThan(0);
    }
  });

  it("every citation quote is a substring of its fetched document text", async () => {
    const out = await runSearchAndCite(deps(), { query: "grounded" });
    expect(out.grounded).toBe(true);
    for (const c of out.citations) {
      const doc = await deps().fetcher.fetch(c.url);
      expect(doc.text.includes(c.quote.toLowerCase())).toBe(true);
    }
  });

  it("dedupes duplicate provider results so a URL is fetched and cited once", async () => {
    const provider = new MockSearchProvider();
    // Spy: count how many times each URL is fetched.
    const fetches = new Map<string, number>();
    const base = new MockFetcher();
    const fetcher: Fetcher = {
      async fetch(url: string) {
        fetches.set(url, (fetches.get(url) ?? 0) + 1);
        return base.fetch(url);
      },
    };
    const out = await runSearchAndCite(
      { provider, fetcher, maxSources: 5, minTrust: 0.5 },
      { query: "grounded" },
    );
    expect(out.grounded).toBe(true);
    const urls = out.citations.map((c) => c.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const n of fetches.values()) {
      expect(n).toBe(1); // never fetch the same URL twice
    }
  });

  it("grounding fails with errors when no source passes the trust threshold", async () => {
    const out = await runSearchAndCite(
      { ...deps(), minTrust: 0.9999 },
      { query: "grounded", requireGrounding: true },
    );
    expect(out.grounded).toBe(false);
    expect(out.errors).toBeTruthy();
    expect(out.citations.length).toBe(0);
  });
});

describe("provenance validation", () => {
  it("rejects a citation whose URL was not in the search result set", () => {
    const results: SearchResult[] = [
      { url: "https://example.com/guide", title: "Guide", retrievedAt: "2026-01-01T00:00:00Z" },
    ];
    const docsByUrl = new Map<string, FetchedDocument>();
    const err = validateCitations(
      [{ url: "https://fake.invalid/not-searched", title: "X", quote: "anything" }],
      docsByUrl,
      results,
    );
    expect(err.length).toBe(1);
    expect(err[0].reason).toMatch(/not returned by the search provider/);
  });

  it("rejects a citation whose URL was never fetched", () => {
    const results: SearchResult[] = [
      { url: "https://example.com/guide", title: "Guide", retrievedAt: "2026-01-01T00:00:00Z" },
    ];
    const docsByUrl = new Map<string, FetchedDocument>();
    const err = validateCitations(
      [{ url: "https://example.com/guide", title: "Guide", quote: "anything" }],
      docsByUrl,
      results,
    );
    expect(err.length).toBe(1);
    expect(err[0].reason).toMatch(/never fetched/);
  });

  it("rejects a citation whose quote is not in the document text", () => {
    const results: SearchResult[] = [
      { url: "https://example.com/guide", title: "Guide", retrievedAt: "2026-01-01T00:00:00Z" },
    ];
    const docsByUrl = new Map<string, FetchedDocument>([
      [
        "https://example.com/guide",
        { url: "https://example.com/guide", title: "Guide", text: "the actual page text", fetchedAt: "2026-01-01T00:00:00Z" },
      ],
    ]);
    const err = validateCitations(
      [{ url: "https://example.com/guide", title: "Guide", quote: "this is NOT in the page" }],
      docsByUrl,
      results,
    );
    expect(err.length).toBe(1);
    expect(err[0].reason).toMatch(/not present in the fetched document/);
  });

  it("accepts valid citations", () => {
    const results: SearchResult[] = [
      { url: "https://example.com/guide", title: "Guide", retrievedAt: "2026-01-01T00:00:00Z" },
    ];
    const docsByUrl = new Map<string, FetchedDocument>([
      [
        "https://example.com/guide",
        { url: "https://example.com/guide", title: "Guide", text: "grounding requires evidence from the page", fetchedAt: "2026-01-01T00:00:00Z" },
      ],
    ]);
    const err = validateCitations(
      [{ url: "https://example.com/guide", title: "Guide", quote: "grounding requires evidence" }],
      docsByUrl,
      results,
    );
    expect(err.length).toBe(0);
  });
});

describe("firstSentence edge cases", () => {
  it("does not truncate at periods inside URLs (e.g. example.com)", () => {
    const text = extractText(fixtureUrlContent.html).toLowerCase();
    const sentence = firstSentence(text);
    expect(sentence).toBe(fixtureUrlContent.expectedFirstSentence);
    // The period in "example.com" must NOT be treated as a sentence boundary.
    expect(sentence).not.toBe("test article visit example.");
  });

  it("returns empty string when no sentence boundary exists", () => {
    expect(firstSentence("no sentence ending here")).toBe("");
  });

  it("handles exclamation and question marks", () => {
    expect(firstSentence("Is this grounded? Yes it is.")).toBe("Is this grounded?");
    expect(firstSentence("Grounded! This is great.")).toBe("Grounded!");
  });
});

describe("fetchWithConcurrency", () => {
  const fixture = {
    texts: {
      "https://example.com/a": "alpha document text for grounding.",
      "https://example.com/b": "bravo document text for grounding.",
    },
    urls: [
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ],
  };

  function makeFetcher(delayMs = 0) {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher = {
      async fetch(url: string) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, delayMs));
        inFlight -= 1;
        const text = fixture.texts[url as keyof typeof fixture.texts];
        if (!text) throw new Error(`failed to fetch ${url}: 404`);
        return {
          url,
          title: url,
          text,
          fetchedAt: new Date().toISOString(),
        };
      },
      inFlight() {
        return inFlight;
      },
      maxInFlight() {
        return maxInFlight;
      },
    };
    return fetcher;
  }

  it("preserves input order and bounds concurrency", async () => {
    const fetcher = makeFetcher(5);
    const { docs, errors } = await fetchWithConcurrency(fixture.urls, fetcher, 2);
    expect(docs.map((d) => d.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/failed to fetch https:\/\/example\.com\/c/);
    expect(fetcher.maxInFlight()).toBeLessThanOrEqual(2);
  });

  it("serializes when limit is 1", async () => {
    const fetcher = makeFetcher(3);
    const { docs } = await fetchWithConcurrency([fixture.urls[0], fixture.urls[1]], fetcher, 1);
    expect(docs).toHaveLength(2);
    expect(fetcher.maxInFlight()).toBe(1);
  });

  it("handles empty input", async () => {
    const fetcher = makeFetcher(0);
    const { docs, errors } = await fetchWithConcurrency([], fetcher, 4);
    expect(docs).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

describe("selectQuote", () => {
  const text =
    "a generic introduction with nothing useful. later the article finally discusses grounding with verifiable evidence and primary sources.";

  it("picks a passage containing a significant query term over the first sentence", () => {
    const quote = selectQuote(text, "grounding");
    expect(text.includes(quote)).toBe(true); // verbatim substring
    expect(quote).toContain("grounding");
    expect(quote).not.toContain("a generic introduction");
  });

  it("returns a verbatim substring of the source text", () => {
    const long =
      "before before before before before before before before before before " +
      "before before before before before before before before before before " +
      "before before before before before before before before before before " +
      "needle hidden in the middle of a long page after many words before.";
    const quote = selectQuote(long, "needle");
    expect(long.includes(quote)).toBe(true);
    expect(quote).toContain("needle");
  });

  it("falls back to the first sentence when no query term appears in the text", () => {
    const q = selectQuote("no relevant terms here at all.", "zzzz");
    expect(q).toBe("no relevant terms here at all.");
  });

  it("extracts only significant terms from a query", () => {
    expect(significantTerms("how to ground citations")).toContain("ground");
    expect(significantTerms("how to ground citations")).not.toContain("how");
    expect(significantTerms("the of and")).toHaveLength(0);
  });

  it("keeps accented terms intact when extracting from a query", () => {
    // An ASCII-only splitter would truncate "café" to "caf" (the é is not
    // [a-z0-9]); the term must survive whole so it cannot match inside
    // unrelated words like "cafeteria".
    const terms = significantTerms("best café in paris");
    expect(terms).toContain("café");
    expect(terms).not.toContain("caf");
  });

  it("prefers an informative mid-document sentence over page-top boilerplate", () => {
    const text =
      "skip to content main menu navigation. " +
      "the article explains how grounding works with verifiable evidence from fetched pages.";
    const quote = selectQuote(text, "grounding");
    expect(text.includes(quote)).toBe(true);
    expect(quote).toContain("grounding");
    expect(quote).not.toContain("skip to content");
    expect(quote).not.toContain("main menu");
    expect(quote).not.toContain("navigation");
  });

  it("prefers a body sentence with more query terms over a nav sentence with fewer", () => {
    const text =
      "menu node list home about contact. " +
      "the node runtime for javascript developers provides a solid foundation for node applications.";
    const quote = selectQuote(text, "node javascript runtime");
    expect(text.includes(quote)).toBe(true);
    expect(quote).toContain("node");
    expect(quote).toContain("javascript");
    expect(quote).toContain("runtime");
    expect(quote).not.toContain("menu");
  });

  it("splits sentences correctly without breaking URL periods", () => {
    const sentences = splitSentences(
      "test article visit example.com for more details about grounding. this is the second sentence.",
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toBe("test article visit example.com for more details about grounding.");
    expect(sentences[1]).toBe("this is the second sentence.");
  });

  it("returns a URL-path-derived title when the document title is empty", () => {
    const title = fallbackTitle("https://example.com/docs/grounding-guide");
    expect(title).toBe("Grounding Guide");
  });

  it("returns 'Source' for a URL with no meaningful path segment", () => {
    expect(fallbackTitle("https://example.com/")).toBe("Source");
  });

  it("does not count a query term that only occurs inside a longer word", () => {
    const text =
      "the startup guide begins now. this article has many words. art matters most of all here.";
    const quote = selectQuote(text, "art");
    // Substring matching would score all three sentences (startup/article/art)
    // and tie-break to the first; word-boundary matching must prefer the
    // sentence where "art" is its own word.
    expect(text.includes(quote)).toBe(true);
    expect(quote).toContain("art");
    expect(quote).not.toContain("startup");
    expect(quote).not.toContain("article");
  });

  it("matches query terms at hyphen and period boundaries", () => {
    const text = "node-runtime is fast and reliable. visit node.js for the full reference.";
    const quote = selectQuote(text, "node");
    expect(text.includes(quote)).toBe(true);
    // The first sentence wins the tie and its "node" sits on a hyphen
    // boundary — a word-boundary regex must not require whitespace.
    expect(quote).toContain("node-runtime");
  });

  it("does not count a query term that only occurs inside an accented word", () => {
    // The old ASCII-only boundary regex ([a-z0-9]) treated "í" as a non-word
    // char, so "art" spuriously matched inside "artículo". Unicode-aware
    // boundaries must prefer the sentence where "art" is its own word.
    const text =
      "el artículo sobre cultura moderna. art matters most of all in this overview of the movement.";
    const quote = selectQuote(text, "art");
    expect(text.includes(quote)).toBe(true);
    expect(quote).toContain("art");
    expect(quote).not.toContain("artículo");
  });
});

describe("strict grounding mode (requireGrounding)", () => {
  it("no-results failure has the documented structured shape", async () => {
    const provider = { id: "empty", async search() { return strictGroundingFixture.emptyResults; } };
    const out = await runSearchAndCite(
      { provider, fetcher: new MockFetcher(), maxSources: 5, minTrust: 0.5 },
      { query: "anything", requireGrounding: true },
    );
    expect(out.grounded).toBe(false);
    expect(out.citations).toEqual([]);
    expect(out.errors).toEqual(strictGroundingFixture.expectedFailureShape.errors);
  });

  it("trust-threshold failure carries structured errors for the tool layer", async () => {
    const out = await runSearchAndCite(
      { ...deps(), minTrust: 0.9999 },
      { query: "grounded", requireGrounding: true },
    );
    expect(out.grounded).toBe(false);
    expect(out.errors?.length).toBeGreaterThan(0);
    expect(out.errors?.some((e) => e.includes("no sources passed the trust threshold"))).toBe(true);
  });
});

describe("scoring", () => {
  const doc: FetchedDocument = {
    url: "https://example.com/guide",
    title: "Guide",
    text: "a sufficiently long page body with lots of content that is longer than eighty characters to pass the thin-content check.",
    fetchedAt: "2026-01-01T00:00:00Z",
  };

  it("scores allowed domains above the threshold", () => {
    expect(scoreDocument(doc, { minTrust: 0.5 })).toBeGreaterThanOrEqual(0.5);
  });

  it("scores zero for denied domains", () => {
    expect(scoreDocument(doc, { minTrust: 0, denyDomains: ["example.com"] })).toBe(0);
  });

  it("dedupes by canonical URL", () => {
    const items = [{ url: "a" }, { url: "a" }, { url: "b" }];
    expect(dedupeByUrl(items)).toHaveLength(2);
  });

  it("collapses tracking-param/fragment/trailing-slash URL variants as one source", () => {
    const base = "https://example.com/docs/guide";
    const variants = [
      { url: `${base}` },
      { url: `${base}/` },
      { url: `${base}#section-2` },
      { url: `${base}?utm_source=newsletter&utm_medium=email&srsltid=AfmBOoq1` },
      { url: `${base}?gclid=Cj0K&utm_campaign=launch` },
      { url: `${base}?msclkid=abc123` },
    ];
    const deduped = dedupeByUrl(variants);
    expect(deduped).toHaveLength(1);
    // First occurrence's original URL is preserved for provenance.
    expect(deduped[0].url).toBe(base);
  });

  it("keeps distinct pages that share a query prefix", () => {
    const items = [
      { url: "https://example.com/search?q=1" },
      { url: "https://example.com/search?q=2" },
    ];
    expect(dedupeByUrl(items)).toHaveLength(2);
  });

  it("falls back to exact match for unparseable URLs", () => {
    const items = [{ url: "not a url" }, { url: "not a url" }, { url: "other" }];
    expect(dedupeByUrl(items)).toHaveLength(2);
  });

  it("canonicalUrlKey is stable across variant orderings", () => {
    const a = "https://example.com/x?utm_campaign=summer&q=1";
    const b = "https://example.com/x/?q=1#top";
    expect(canonicalUrlKey(a)).toBe(canonicalUrlKey(b));
  });

  it("collapses scheme and www-prefix variants of one page", () => {
    const variants = [
      { url: "https://example.com/docs/guide" },
      { url: "http://example.com/docs/guide" },
      { url: "https://www.example.com/docs/guide" },
      { url: "http://www.example.com/docs/guide?utm_source=x" },
    ];
    const deduped = dedupeByUrl(variants);
    expect(deduped).toHaveLength(1);
    // First occurrence's original URL is preserved for provenance.
    expect(deduped[0].url).toBe("https://example.com/docs/guide");
  });

  it("keeps distinct subdomains that share a path", () => {
    const items = [
      { url: "https://docs.example.com/guide" },
      { url: "https://blog.example.com/guide" },
    ];
    expect(dedupeByUrl(items)).toHaveLength(2);
  });

  it("canonicalUrlKey normalizes scheme and www prefix", () => {
    expect(canonicalUrlKey("https://WWW.Example.COM/x")).toBe(
      canonicalUrlKey("http://example.com/x"),
    );
    expect(canonicalUrlKey("https://example.com/x")).toBe(
      canonicalUrlKey("https://www.example.com/x"),
    );
  });

  it("canonicalUrlKey collapses explicit default ports", () => {
    expect(canonicalUrlKey("https://example.com:443/docs/guide")).toBe(
      canonicalUrlKey("https://example.com/docs/guide"),
    );
    // An http variant that carried an explicit :80 collapses with its
    // https form once the scheme is normalized (port value kept on rewrite).
    expect(canonicalUrlKey("http://example.com:80/docs/guide")).toBe(
      canonicalUrlKey("https://example.com/docs/guide"),
    );
  });

  it("canonicalUrlKey keeps non-default ports distinct", () => {
    expect(canonicalUrlKey("https://example.com:8443/x")).not.toBe(
      canonicalUrlKey("https://example.com/x"),
    );
  });

  it("selects only sources above the threshold", () => {
    const selected = selectSources([doc], { minTrust: 0.9 }, 5);
    expect(selected).toHaveLength(0);
  });
});

describe("OpenClawWebSearchProvider", () => {
  function runtimeWith(result: Record<string, unknown>, throwErr?: Error) {
    return {
      webSearch: {
        async search() {
          if (throwErr) throw throwErr;
          return { provider: "test", result };
        },
      },
    };
  }

  it("extracts URLs only from the runtime result set (results shape)", () => {
    const provider = new OpenClawWebSearchProvider(
      runtimeWith({
        kind: "results",
        results: [
          { url: "https://a.example/x", title: "A", snippet: "sa" },
          { url: "https://b.example/y", title: "B", snippet: "sb" },
        ],
      }),
    );
    return expect(provider.search("q", { maxResults: 5 })).resolves.toMatchObject([
      { url: "https://a.example/x", title: "A" },
      { url: "https://b.example/y", title: "B" },
    ]);
  });

  it("extracts from the citations shape and dedupes URLs", () => {
    const out = extractResultsFromWebSearchOutput(
      {
        kind: "answer",
        citations: [
          { url: "https://a.example/x", title: "A" },
          { url: "https://a.example/x", title: "A dup" },
          { url: "https://b.example/y", title: "B" },
        ],
      },
      5,
    );
    expect(out.map((r) => r.url)).toEqual(["https://a.example/x", "https://b.example/y"]);
  });

  it("drops non-http(s) and malformed URLs instead of citing them", () => {
    const out = extractResultsFromWebSearchOutput(
      {
        results: [
          { url: "javascript:alert(1)", title: "bad" },
          { url: "not a url", title: "bad2" },
          { url: "ftp://files.example/z", title: "bad3" },
          { url: "https://ok.example/good", title: "good" },
        ],
      },
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://ok.example/good");
  });

  it("throws a structured error when the provider returns no citable URLs", async () => {
    const provider = new OpenClawWebSearchProvider(runtimeWith({ kind: "answer", answer: "no urls" }));
    await expect(provider.search("q", { maxResults: 5 })).rejects.toThrow(/no citable URLs/);
  });

  it("wraps runtime failures in a clear provider error", async () => {
    const provider = new OpenClawWebSearchProvider(runtimeWith({}, new Error("provider down")));
    await expect(provider.search("q", { maxResults: 5 })).rejects.toThrow(/web-search provider failed: provider down/);
  });
});
