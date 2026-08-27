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

/** Deduplicate by canonical URL. */
export function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (!seen.has(it.url)) {
      seen.add(it.url);
      out.push(it);
    }
  }
  return out;
}
