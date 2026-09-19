/* global Response */
import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpFetcher, isTransientStatus, retryAfterMs, backoffWithJitter } from "../src/fetch.js";

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

  it("honors a numeric Retry-After header on 429 (capped at 5s)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("slow down", {
            status: 429,
            headers: { "content-type": "text/plain", "retry-after": "1" },
          });
        }
        return okHtml();
      }),
    );
    const origSetTimeout = globalThis.setTimeout;
    const spy = vi.fn((fn: () => void, _ms?: number) => origSetTimeout(fn, 0));
    vi.stubGlobal("setTimeout", spy);
    const fetcher = new HttpFetcher(1000, 2);
    const doc = await fetcher.fetch("https://example.com/ratelimited");
    expect(calls).toBe(2);
    expect(doc.text).toContain("grounding page");
    // The retry delay must equal the Retry-After value (1000ms), not the
    // exponential default (250ms).
    const retryCall = spy.mock.calls.find((c) => typeof c[1] === "number" && c[1] > 0);
    expect(retryCall?.[1]).toBe(1000);
    // Cap check via unit table below (retryAfterMs).
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

describe("backoffWithJitter", () => {
  it("scales exponentially and applies ±20% jitter (rounded)", () => {
    expect(backoffWithJitter(0, () => 0.5)).toBe(250); // no jitter effect at 0.5
    expect(backoffWithJitter(2, () => 0)).toBe(800); // 250*4*0.8
    expect(backoffWithJitter(2, () => 1)).toBe(1200); // 250*4*1.2
    expect(backoffWithJitter(0, () => 0.25)).toBe(225); // 250*0.9
  });
});

describe("retryAfterMs", () => {
  it("parses delay-seconds and caps at 5s", () => {
    expect(retryAfterMs("1")).toBe(1000);
    expect(retryAfterMs("0")).toBe(0);
    expect(retryAfterMs("999")).toBe(5000); // capped
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("-3")).toBeUndefined();
  });

  it("parses HTTP-date form: future date → capped delta, past date → undefined", () => {
    const inTwoSeconds = new Date(Date.now() + 2000).toUTCString();
    const got = retryAfterMs(inTwoSeconds);
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThanOrEqual(5000);
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(retryAfterMs(past)).toBeUndefined();
    expect(retryAfterMs("not-a-date, 99Foo 9999 99:99:99 GMT")).toBeUndefined();
  });
});
