/* global Response */
import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpFetcher, isTransientStatus } from "../src/fetch.js";

function okHtml() {
  return new Response("<html><body><p>hello grounding page</p></body></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpFetcher retry/backoff", () => {
  it("retries transient 500 and succeeds on a later attempt", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls < 3) return new Response("boom", { status: 500 });
        return okHtml();
      }),
    );
    const fetcher = new HttpFetcher(1000, 3);
    const doc = await fetcher.fetch("https://example.com/ok");
    expect(calls).toBe(3);
    expect(doc.text).toContain("grounding page");
  });

  it("does not retry permanent client errors (404)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("nope", { status: 404 });
      }),
    );
    const fetcher = new HttpFetcher(1000, 3);
    await expect(fetcher.fetch("https://example.com/missing")).rejects.toThrow(/HTTP 404/);
    expect(calls).toBe(1);
  });

  it("gives up after maxRetries and throws the last error", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("overloaded", { status: 503 });
      }),
    );
    const fetcher = new HttpFetcher(1000, 2);
    await expect(fetcher.fetch("https://example.com/down")).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("retries network-level failures (TypeError fetch failed)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls < 2) throw new TypeError("fetch failed");
        return okHtml();
      }),
    );
    const fetcher = new HttpFetcher(1000, 2);
    const doc = await fetcher.fetch("https://example.com/flaky");
    expect(calls).toBe(2);
    expect(doc.text).toContain("grounding page");
  });
});

describe("isTransientStatus", () => {
  it("marks 429 and 5xx transient, others permanent", () => {
    expect(isTransientStatus(429)).toBe(true);
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(404)).toBe(false);
    expect(isTransientStatus(403)).toBe(false);
    expect(isTransientStatus(200)).toBe(false);
  });
});
