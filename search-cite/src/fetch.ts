/**
 * Page retrieval with redirect handling and timeouts.
 *
 * The Fetcher resolves a URL to its canonical final URL and extracted text.
 * A cited URL always corresponds to a document that was actually fetched.
 */

import type { FetchedDocument, Fetcher } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_AFTER_MS = 5000;

/**
 * Transient HTTP statuses worth retrying: rate limiting and server-side
 * failures. Client errors (4xx except 429) are permanent — retrying them
 * would just burn time.
 */
export function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Minimal HTTP text fetcher with redirect, timeout, and bounded retries. */
export class HttpFetcher implements Fetcher {
  constructor(
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly maxRetries: number = DEFAULT_MAX_RETRIES,
  ) {}

  async fetch(url: string): Promise<FetchedDocument> {
    let lastError: Error = new Error(`fetch ${url}: no attempts made`);
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.fetchOnce(url);
      } catch (e) {
        lastError = e as Error;
        // Retry only transient statuses (429/5xx) and network-level failures;
        // abort-timeout, content-type, and client errors are permanent.
        const transient =
          (e instanceof FetchError && e.transientStatus !== 0) ||
          (e instanceof TypeError && !String(lastError.message).includes("abort"));
        if (!transient || attempt === this.maxRetries) break;
        // Honor a server-provided Retry-After when present (capped), else
        // fall back to bounded exponential backoff.
        const retryAfter = e instanceof FetchError ? e.retryAfterMs : undefined;
        const delay = retryAfter ?? RETRY_BASE_DELAY_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  private async fetchOnce(url: string): Promise<FetchedDocument> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "openclaw-search-cite/0.1" },
      });
      if (!res.ok) {
        if (isTransientStatus(res.status)) {
          throw new FetchError(
            `fetch ${url}: HTTP ${res.status}`,
            res.status,
            retryAfterMs(res.headers.get("retry-after")),
          );
        }
        throw new FetchError(`fetch ${url}: HTTP ${res.status}`);
      }
      const contentType = res.headers.get("content-type");
      if (contentType && !isSupportedTextContentType(contentType)) {
        throw new FetchError(`fetch ${url}: unsupported content-type "${contentType}" (binary payloads cannot be cited)`);
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
 * Fetch error with a marker for retryable (transient) conditions. Shared
 * instance-safe: no state is kept on the fetcher between concurrent calls.
 */
class FetchError extends Error {
  constructor(
    message: string,
    readonly transientStatus = 0,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/**
 * Parse the Retry-After header. Supports delay-seconds; HTTP dates are
 * ignored (parsing them adds risk for little gain — fallback backoff is
 * used instead). Values are capped at MAX_RETRY_AFTER_MS so a hostile
 * server cannot stall a fetch for minutes.
 */
export function retryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
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
