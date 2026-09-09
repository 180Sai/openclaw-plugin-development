#!/usr/bin/env node
/**
 * Grounding evaluation runner (CI-gated).
 *
 * Drives the mock provider pipeline against fixed queries and asserts the
 * grounding invariants. Exits non-zero on any regression so CI can gate
 * merges. Credential-free by design: this runs in CI without API keys.
 */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { MockSearchProvider, MockFetcher } from "../dist/search.js";
import { runSearchAndCite, firstSentence, fetchWithConcurrency } from "../dist/pipeline.js";
import { extractText } from "../dist/fetch.js";
import { fixtureUrlContent } from "../fixtures/url-periods.mjs";
import { concurrencyFixture } from "../fixtures/fetch-concurrency.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Fixed benchmark table: query -> minimum number of grounded citations.
const BENCHMARK = [
  { query: "grounded", expectCitations: 1 },
  { query: "example", expectCitations: 1 },
];

// Edge-case checks: firstSentence must not break on periods inside URLs.
const EDGE_CASES = [
  {
    name: "url-periods: firstSentence skips periods in URLs",
    run() {
      const text = extractText(fixtureUrlContent.html).toLowerCase();
      const sentence = firstSentence(text);
      if (sentence !== fixtureUrlContent.expectedFirstSentence) {
        throw new Error(`got "${sentence}" expected "${fixtureUrlContent.expectedFirstSentence}"`);
      }
    },
  },
  {
    name: "fetch-concurrency: bounded concurrency preserves order and collects failures",
    async run() {
      let inFlight = 0;
      let maxInFlight = 0;
      const fetcher = {
        async fetch(url) {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight -= 1;
          const text = concurrencyFixture.texts[url];
          if (!text) throw new Error(`failed to fetch ${url}: 404`);
          return {
            url,
            title: url,
            text,
            fetchedAt: new Date().toISOString(),
          };
        },
      };
      const { docs, errors } = await fetchWithConcurrency(concurrencyFixture.urls, fetcher);
      const got = docs.map((d) => d.url.split("/").pop());
      if (JSON.stringify(got) !== JSON.stringify(concurrencyFixture.expectedOrder)) {
        throw new Error(`expected order ${concurrencyFixture.expectedOrder}, got ${got}`);
      }
      if (maxInFlight > concurrencyFixture.limit) {
        throw new Error(`concurrency exceeded: max ${maxInFlight} > ${concurrencyFixture.limit}`);
      }
      if (errors.length !== 1 || !errors[0].includes(concurrencyFixture.failingUrl)) {
        throw new Error(`expected one failure for ${concurrencyFixture.failingUrl}, got ${errors}`);
      }
    },
  },
];

const THRESHOLD = 1.0; // all queries must pass grounding fully

async function main() {
  let failures = 0;
  let total = 0;

  for (const q of BENCHMARK) {
    total += 1;
    const provider = new MockSearchProvider();
    const fetcher = new MockFetcher();
    try {
      const out = await runSearchAndCite(
        { provider, fetcher, maxSources: 5, minTrust: 0.5 },
        { query: q.query },
      );
      let ok = out.grounded && out.citations.length >= q.expectCitations;
      // Verify every quote is a verbatim substring of its fetched document.
      for (const c of out.citations) {
        const d = await fetcher.fetch(c.url);
        if (!d.text.includes(c.quote.toLowerCase())) {
          ok = false;
          failures += 1;
          console.error(`FAIL [${q.query}] quote not grounded: ${c.url}`);
        }
      }
      if (!ok) {
        failures += 1;
        console.error(
          `FAIL [${q.query}] grounded=${out.grounded} citations=${out.citations.length} (expected ${q.expectCitations})`,
        );
      } else {
        console.log(`PASS [${q.query}] ${out.citations.length} grounded citation(s)`);
      }
    } catch (e) {
      failures += 1;
      console.error(`ERROR [${q.query}] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Edge-case checks (firstSentence, extractText invariants).
  for (const ec of EDGE_CASES) {
    total += 1;
    try {
      ec.run();
      console.log(`PASS [edge] ${ec.name}`);
    } catch (e) {
      failures += 1;
      console.error(`FAIL [edge] ${ec.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const score = (total - failures) / total;
  console.log(`\nGrounding score: ${Math.round(score * 100)}% (${total - failures}/${total})`);
  if (score < THRESHOLD) {
    console.error(`Eval failed: score ${score} < threshold ${THRESHOLD}`);
    process.exit(1);
  }
  console.log("Eval passed.");
  process.exit(0);
}

main();
