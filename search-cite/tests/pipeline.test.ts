import { describe, it, expect } from "vitest";
import { MockSearchProvider, MockFetcher } from "../src/search.js";
import { runSearchAndCite, firstSentence, fetchWithConcurrency } from "../src/pipeline.js";
import { validateCitations } from "../src/provenance.js";
import { scoreDocument, selectSources, dedupeByUrl } from "../src/scoring.js";
import { extractText } from "../src/fetch.js";
import type { FetchedDocument, SearchResult } from "../src/types.js";
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
