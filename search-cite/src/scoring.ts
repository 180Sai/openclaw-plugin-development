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
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    u.hostname = host;
    const path =
      u.pathname.length > 1 && u.pathname.endsWith("/")
        ? u.pathname.slice(0, -1)
        : u.pathname;
    return `${u.protocol}//${host}${portSuffix(u.port)}${path}${u.search}`;
  } catch {
    return url;
  }
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
