/* global Response */
import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpFetcher, isOversizedContentLength } from "../src/fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function okHtml() {
  return new Response("<html><body><p>hello grounding page</p></body></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

describe("HttpFetcher response-body cap", () => {
  it("rejects a body exceeding the cap via Content-Length before reading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("x".repeat(100), {
          status: 200,
          headers: { "content-type": "text/plain", "content-length": "999999" },
        }),
      ),
    );
    const fetcher = new HttpFetcher(1000, 2, 1000);
    await expect(fetcher.fetch("https://example.com/huge")).rejects.toThrow(/content-length 999999 exceeds 1000-byte cap/);
  });

  it("rejects an oversized body when Content-Length is missing (post-read check)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("x".repeat(5000), {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );
    const fetcher = new HttpFetcher(1000, 2, 1000);
    await expect(fetcher.fetch("https://example.com/lying")).rejects.toThrow(/response body exceeds 1000-char cap/);
  });

  it("does not retry oversized-body rejections (permanent error)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("x".repeat(5000), {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }),
    );
    const fetcher = new HttpFetcher(1000, 3, 1000);
    await expect(fetcher.fetch("https://example.com/always-huge")).rejects.toThrow(/response body exceeds 1000-char cap/);
    expect(calls).toBe(1); // never retried
  });

  it("accepts a body at or under the cap", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return okHtml();
      }),
    );
    const fetcher = new HttpFetcher(1000, 2, 1000);
    const doc = await fetcher.fetch("https://example.com/ok");
    expect(calls).toBe(1);
    expect(doc.text).toContain("grounding page");
  });
});

describe("isOversizedContentLength", () => {
  it("flags declared lengths above the cap", () => {
    expect(isOversizedContentLength("5", 4)).toBe(true);
    expect(isOversizedContentLength("4", 4)).toBe(false);
  });
  it("tolerates missing/invalid/negative headers so the post-read check decides", () => {
    expect(isOversizedContentLength(null, 4)).toBe(false);
    expect(isOversizedContentLength("", 4)).toBe(false);
    expect(isOversizedContentLength("nonsense", 4)).toBe(false);
    expect(isOversizedContentLength("-1", 4)).toBe(false);
    expect(isOversizedContentLength("Infinity", 4)).toBe(false);
  });
});