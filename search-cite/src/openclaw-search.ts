/**
 * OpenClaw runtime web-search adapter.
 *
 * Wraps `api.runtime.webSearch` — the same provider machinery that backs the
 * core `web_search` tool (SearXNG, DuckDuckGo, Brave, Tavily, Gemini, ...) —
 * into the plugin's `SearchProvider` contract, so search_and_cite always uses
 * whatever provider the gateway is configured with. No provider credentials
 * or endpoints live in this plugin; provider selection, credentials, and
 * retries stay in core (see docs/plugins/architecture-internals.md).
 *
 * Grounding invariants are preserved: URLs may only come from the runtime
 * provider's returned result set. Anything else is dropped, and an empty
 * result set surfaces as a structured error (never fabricated results).
 */

import type { SearchProvider, SearchResult } from "./types.js";

const now = () => new Date().toISOString();

/** Minimal structural contract for the OpenClaw plugin runtime web-search surface. */
export interface RuntimeWebSearchLike {
  webSearch: {
    search(params: { args: Record<string, unknown> }): Promise<{
      provider: string;
      result: Record<string, unknown>;
    }>;
    listProviders?(params?: unknown): unknown;
  };
}

/** Loose shape of a single normalized result entry from a provider. */
interface RawResultEntry {
  url?: unknown;
  title?: unknown;
  snippet?: unknown;
  content?: unknown;
  score?: unknown;
}

function absoluteHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Extract candidate URLs from a normalized web-search output. Handles both
 * closed shapes documented for the core web_search boundary:
 *  - `kind: "results"` → `results: [{ url, title, snippet, ... }]`
 *  - `kind: "answer"`  → `citations: [{ url, title, ... }]` (optional)
 * Unknown shapes yield an empty set (callers must not fabricate URLs).
 */
export function extractResultsFromWebSearchOutput(
  payload: Record<string, unknown>,
  maxResults: number,
): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const candidates: RawResultEntry[] = Array.isArray(payload.results)
    ? (payload.results as RawResultEntry[])
    : Array.isArray(payload.citations)
      ? (payload.citations as RawResultEntry[])
      : [];

  for (const entry of candidates) {
    if (out.length >= maxResults) break;
    if (!entry || typeof entry !== "object") continue;
    const url = absoluteHttpUrl(entry.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: asString(entry.title),
      snippet: asString(entry.snippet ?? entry.content) || undefined,
      score: typeof entry.score === "number" ? entry.score : undefined,
      retrievedAt: now(),
    });
  }
  return out;
}

/** SearchProvider backed by OpenClaw's runtime web-search provider registry. */
export class OpenClawWebSearchProvider implements SearchProvider {
  readonly id = "openclaw";
  constructor(private readonly runtime: RuntimeWebSearchLike) {}

  async search(query: string, opts: { maxResults: number }): Promise<SearchResult[]> {
    let response: { provider: string; result: Record<string, unknown> };
    try {
      response = await this.runtime.webSearch.search({
        args: { query, count: opts.maxResults },
      });
    } catch (err) {
      throw new Error(
        `openclaw web-search provider failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const payload = response?.result ?? {};
    const results = extractResultsFromWebSearchOutput(payload, opts.maxResults);
    if (results.length === 0) {
      // Structured, clear failure — never return fabricated or padded results.
      throw new Error(
        `openclaw web-search provider "${response?.provider ?? "unknown"}" returned no citable URLs for query "${query}"`,
      );
    }
    return results;
  }
}
