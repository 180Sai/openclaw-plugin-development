import { describe, it, expect } from "vitest";
import { MockSearchProvider, MockFetcher } from "../src/search.js";
import { runSearchAndCite, firstSentence } from "../src/pipeline.js";
import { validateCitations } from "../src/provenance.js";
import { scoreDocument, selectSources, dedupeByUrl } from "../src/scoring.js";
import { extractText } from "../src/fetch.js";
import type { FetchedDocument, SearchResult } from "../src/types.js";
import type { Fetcher } from "../src/types.js";
import { fixtureUrlContent } from "../fixtures/url-periods.mjs";

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

  it("selects only sources above the threshold", () => {
    const selected = selectSources([doc], { minTrust: 0.9 }, 5);
    expect(selected).toHaveLength(0);
  });
});
