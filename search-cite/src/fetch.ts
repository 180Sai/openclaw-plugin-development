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
      const contentType = res.headers.get("content-type");
      if (contentType && !isSupportedTextContentType(contentType)) {
        throw new Error(`fetch ${url}: unsupported content-type "${contentType}" (binary payloads cannot be cited)`);
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

/**
 * A page is citable only when it is textual (HTML/plain text/known text-ish
 * XML variants). Binary payloads (PDF, images, archives) would produce
 * garbage extracted text that must never be quoted. Missing content-type is
 * treated as text so permissive servers are not blocked.
 */
export function isSupportedTextContentType(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "" || type.startsWith("text/")) return true;
  return TEXT_MEDIA_TYPES.has(type);
}

const TEXT_MEDIA_TYPES = new Set([
  "application/xhtml+xml",
  "application/xml",
  "application/json",
  "application/ld+json",
]);

/** Strip scripts/styles/tags and normalize whitespace from HTML. */
export function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract <title> from HTML. */
export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}
