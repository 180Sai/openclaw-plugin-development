/**
 * Trust/domain filtering and source selection.
 *
 * The `scoring` module decides which fetched sources are trustworthy enough to
 * cite, based on the configured `minTrust` and any domain allowlist/denylist.
 * A source that fails the threshold is excluded from citations.
 */

import type { FetchedDocument } from "./types.js";

export interface ScoringOptions {
  /** Minimum trust in [0,1] for a source to be citable. */
  minTrust: number;
  /** Only these hostnames may be cited (empty = allow all). */
  allowDomains?: string[];
  /** These hostnames are never cited. */
  denyDomains?: string[];
}

/** Compute a trust score for a fetched document in [0,1]. */
export function scoreDocument(doc: FetchedDocument, opts: ScoringOptions): number {
  let score = 0.6; // base
  try {
    const host = new URL(doc.url).hostname;
    if (opts.allowDomains?.length && !opts.allowDomains.some((d) => host === d || host.endsWith(`.${d}`))) {
      return 0; // not in allowlist
    }
    if (opts.denyDomains?.some((d) => host === d || host.endsWith(`.${d}`))) {
      return 0; // denied
    }
  } catch {
    return 0; // malformed URL
  }
  if (doc.text.length < 80) score -= 0.2; // thin content
  return Math.max(0, Math.min(1, score));
}

/** Pick the top-N sources above the trust threshold. */
export function selectSources(
  docs: FetchedDocument[],
  opts: ScoringOptions,
  max: number,
): FetchedDocument[] {
  return docs
    .map((d) => ({ doc: d, score: scoreDocument(d, opts) }))
    .filter((x) => x.score >= opts.minTrust)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.doc);
}

/**
 * Query/tracking parameters that identify the same page regardless of value.
 * Provider result sets often include utm_* / click-tracking variants of one
 * URL; these must not create duplicate citations.
 */
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "yclid",
  "msclkid",
  "srsltid",
  "igshid",
];

/**
 * Canonical key for dedupe comparisons: scheme-normalized origin + path (no
 * trailing slash) + query minus tracking params, fragment stripped.
 *
 * Scheme (`http` vs `https`), a leading `www.` host prefix, and an explicit
 * default port (e.g. `:443` on https, `:80` on http) do not change which
 * page a URL addresses, and real providers frequently return mixed variants
 * (http/https, with/without www, with/without default port) for one page.
 * Normalizing them to a single key lets those collapse to one citation
 * instead of citing the same page twice. The FIRST occurrence's original URL
 * is still kept (see `dedupeByUrl`), so provenance is never broken by the
 * synthesized scheme.
 *
 * Non-URL strings fall back to an exact match so malformed inputs never
 * collide.
 */
export function canonicalUrlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    // Canonicalize to https so an http/https pair of the same page collapses.
    if (u.protocol === "http:") u.protocol = "https:";
    // Drop a leading `www.` host label: example.com and www.example.com are
    // the same site for dedupe purposes. Lowercase the host too, since DNS is
    // case-insensitive but URL parsing preserves whatever case was returned.
    // Strip a DNS trailing dot (FQDN root marker): example.com. and
    // example.com resolve to the same host (RFC 4343) and share one key.
    const host = u.hostname
      .replace(/^www\./i, "")
      .replace(/\.$/, "")
      .toLowerCase();
    u.hostname = host;
    const path =
      u.pathname.length > 1 && u.pathname.endsWith("/")
        ? u.pathname.slice(0, -1)
        : u.pathname;
    return `${u.protocol}//${host}${portSuffix(u.port)}${normalizePercentEncoding(path)}${sortedSearch(u.searchParams)}`;
  } catch {
    return url;
  }
}

/**
 * DNS trailing-dot normalization.
 *
 * Hostnames can be written with a trailing dot ("example.com."), the root-
 * marker for a fully qualified domain name; the trailing dot belongs to the
 * root zone and the two spellings resolve to the same host. Providers and
 * CMSs occasionally return the FQDN form, which would otherwise split one
 * page into two dedupe keys. Per RFC 4343, trailing dots in hostnames are
 * insignificant.
 *
 * Note: the canonical key is built for dedupe comparisons only. The host is
 * not rewritten in the original URL, so provenance keeps the provider's
 * exact spelling.
 */

/**
 * Percent-encoding normalization for the canonical path.
 *
 * URL parsers keep the encoded form of a path exactly as given, so
 * "caf%C3%A9", "caf%c3%a9" and "café" (auto-encoded to uppercase
 * "caf%C3%A9") would otherwise produce distinct dedupe keys for the same
 * page. Providers escape inconsistently — varying hex-digit case and
 * over-encoding unreserved characters — so:
 *  - hex digits are uppercased: %c3%a9 == %C3%A9
 *  - percent-encoded RFC 3986 *unreserved* characters are decoded to their
 *    literal form: %7Euser == ~user
 * Encoded reserved characters (%2F, %3F, %23, ...) are left untouched, so
 * "a%2Fb" (a literal slash in one segment) never collides with "a/b".
 */
function normalizePercentEncoding(path: string): string {
  return path.replace(/%[0-9a-fA-F]{2}/g, (m) => {
    const code = parseInt(m.slice(1), 16);
    const ch = String.fromCharCode(code);
    if (/[A-Za-z0-9\-._~]/.test(ch)) return ch;
    return `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
  });
}

/**
 * Rebuild a canonical query string from search params, sorted by
 * (name, value), so reordered variants of the same page ("?a=1&b=2" vs
 * "?b=2&a=1") collapse to one key. Parameter-map semantics are
 * order-independent, and providers/CMSs do reorder params for one URL.
 * Returns "" when no params remain — a bare trailing '?' after tracking-
 * param removal folds to no query at all, so ".../page?" and ".../page"
 * dedupe together.
 */
function sortedSearch(params: URLSearchParams): string {
  const entries = [...params.entries()].sort((x, y) => {
    if (x[0] < y[0]) return -1;
    if (x[0] > y[0]) return 1;
    if (x[1] < y[1]) return -1;
    if (x[1] > y[1]) return 1;
    return 0;
  });
  return entries.length ? `?${entries.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
}

/**
 * Include the port only when it is non-default, for stable keys. After
 * scheme normalization the canonical scheme is https, so an explicit `:443`
 * (and the `:80` a mixed http variant may still carry, since the http→https
 * rewrite keeps the port value) is redundant and should not split a page
 * into two dedupe keys.
 */
function portSuffix(port: string): string {
  return port && port !== "443" && port !== "80" ? `:${port}` : "";
}

/**
 * Deduplicate by canonical URL. Variants of the same page (fragment,
 * tracking params, trailing slash) collapse to one entry; the FIRST
 * occurrence's original URL is kept so provenance (URL ∈ provider result
 * set, actually fetched) is never broken by a synthesized URL.
 */
export function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = canonicalUrlKey(it.url);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}
