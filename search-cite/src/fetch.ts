/**
 * Page retrieval with redirect handling and timeouts.
 *
 * The Fetcher resolves a URL to its canonical final URL and extracted text.
 * A cited URL always corresponds to a document that was actually fetched.
 */

import type { FetchedDocument, Fetcher } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10000;

/** Minimal HTTP text fetcher with redirect + timeout handling. */
export class HttpFetcher implements Fetcher {
  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  async fetch(url: string): Promise<FetchedDocument> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "openclaw-search-cite/0.1" },
      });
      if (!res.ok) {
        throw new Error(`fetch ${url}: HTTP ${res.status}`);
      }
      const finalUrl = res.url || url;
      const raw = await res.text();
      const text = extractText(raw);
      const title = extractTitle(raw) ?? new URL(finalUrl).hostname;
      return { url: finalUrl, title, text: text.toLowerCase(), fetchedAt: new Date().toISOString() };
    } finally {
      clearTimeout(timer);
    }
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decode common HTML entities (named + decimal/hex numeric) in extracted
 * text. Without this, a page containing "Fish &amp; Chips" would extract
 * verbatim "Fish &amp; Chips" and a user-facing quote "Fish & Chips" would
 * fail the substring grounding check — or the raw entity would leak into a
 * citation quote. Unknown entities are left untouched.
 */
export function decodeEntities(input: string): string {
  return input.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-z]+);/gi, (m, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        return String.fromCodePoint(code);
      }
      return m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/**
 * Strip scripts/styles/tags, decode HTML entities, and normalize whitespace
 * from HTML.
 */
export function extractText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract <title> from HTML. */
export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}
