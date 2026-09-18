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
import { runSearchAndCite, firstSentence, selectQuote, fetchWithConcurrency } from "../dist/pipeline.js";
import { extractText, isTransientStatus, retryAfterMs } from "../dist/fetch.js";
import { isSupportedTextContentType } from "../dist/fetch.js";
import { fixtureUrlContent } from "../fixtures/url-periods.mjs";
import { strictGroundingFixture } from "../fixtures/strict-grounding.mjs";
import { concurrencyFixture } from "../fixtures/fetch-concurrency.mjs";
import { contentTypeFixture } from "../fixtures/content-type.mjs";
import { queryQuoteContent } from "../fixtures/query-quotes.mjs";
import { duplicateResults } from "../fixtures/duplicate-results.mjs";
import { retryFixture } from "../fixtures/fetch-retry.mjs";
import { boilerplateQuoteContent } from "../fixtures/quote-boilerplate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Fixed benchmark table: query -> minimum number of grounded citations.
const BENCHMARK = [
  { query: "grounded", expectCitations: 1 },
  { query: "example", expectCitations: 1 },
];

// Edge-case checks: firstSentence must not break on periods inside URLs.
const EDGE_CASES = [
  {
    name: "fetch-retry: transient statuses retried, permanent ones fail fast",
    run() {
      for (const s of retryFixture.transient) {
        if (!isTransientStatus(s)) throw new Error(`status ${s} should be transient`);
      }
      for (const s of retryFixture.permanent) {
        if (isTransientStatus(s)) throw new Error(`status ${s} should NOT be transient`);
      }
      if (retryAfterMs(String(retryFixture.retryAfter.parseSeconds)) !== retryFixture.retryAfter.parsedMs) {
        throw new Error("Retry-After seconds should parse to ms");
      }
      if (retryAfterMs("999") !== retryFixture.retryAfter.capMs) {
        throw new Error("Retry-After should be capped at 5s");
      }
      if (retryAfterMs("nonsense") !== undefined) {
        throw new Error("unparseable Retry-After should be undefined");
      }
      const futureDate = new Date(Date.now() + retryFixture.retryAfter.httpDateFutureDeltaMs).toUTCString();
      const delta = retryAfterMs(futureDate);
      if (delta === undefined || delta <= 0 || delta > retryFixture.retryAfter.capMs) {
        throw new Error("future HTTP-date Retry-After should yield a positive capped delta");
      }
      const pastDate = new Date(Date.now() - 60_000).toUTCString();
      if (retryAfterMs(pastDate) !== retryFixture.retryAfter.httpDatePast) {
        throw new Error("past HTTP-date Retry-After should be undefined");
      }
    },
  },
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
    name: "strict-grounding: failure path returns the documented structured shape",
    async run() {
      const provider = { id: "empty", async search() { return strictGroundingFixture.emptyResults; } };
      const out = await runSearchAndCite(
        { provider, fetcher: new MockFetcher(), maxSources: 5, minTrust: 0.5 },
        { query: "anything", requireGrounding: true },
      );
      if (out.grounded !== strictGroundingFixture.expectedFailureShape.grounded) {
        throw new Error(`expected grounded=false, got ${out.grounded}`);
      }
      if (out.citations.length !== 0) {
        throw new Error(`expected zero citations, got ${out.citations.length}`);
      }
      if (JSON.stringify(out.errors) !== JSON.stringify(strictGroundingFixture.expectedFailureShape.errors)) {
        throw new Error(`unexpected errors: ${out.errors}`);
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
  {
    name: "content-type: binary payloads are not citable",
    run() {
      if (isSupportedTextContentType(contentTypeFixture.contentType)) {
        throw new Error(`binary content-type "${contentTypeFixture.contentType}" must be rejected`);
      }
      if (!isSupportedTextContentType("text/html; charset=utf-8")) {
        throw new Error("text/html must be accepted");
      }
      if (!isSupportedTextContentType("")) {
        throw new Error("missing content-type must be tolerated");
      }
    },
  },
  {
    name: "entity-decoding: extractText decodes HTML entities so quotes stay grounded",
    run() {
      const text = extractText(
        '<p>Fish &amp; Chips cost 5&#8364;.</p><p>Caf&#233; &lt;3</p>',
      ).toLowerCase();
      if (text.includes("&amp;") || text.includes("&#")) {
        throw new Error(`raw entities leaked into extracted text: "${text}"`);
      }
      if (!text.includes("fish & chips cost 5€.") || !text.includes("café <3")) {
        throw new Error(`entities not decoded correctly: "${text}"`);
      }
    },
  },
  {
    name: "query-quotes: selectQuote prefers a passage containing the query term",
    run() {
      const text = queryQuoteContent.normalizedText;
      const quote = selectQuote(text, queryQuoteContent.query);
      if (!text.includes(quote)) {
        throw new Error(`quote is not a verbatim substring of the page: "${quote}"`);
      }
      if (!quote.includes(queryQuoteContent.term)) {
        throw new Error(`quote does not contain term "${queryQuoteContent.term}": "${quote}"`);
      }
    },
  },
  {
    name: "quote-boilerplate: selectQuote prefers body sentence over page-top chrome",
    run() {
      const quote = selectQuote(boilerplateQuoteContent.normalizedText, boilerplateQuoteContent.query);
      if (!boilerplateQuoteContent.normalizedText.includes(quote)) {
        throw new Error(`quote is not a verbatim substring of the page: "${quote}"`);
      }
      if (!quote.includes(boilerplateQuoteContent.term)) {
        throw new Error(`quote does not contain term "${boilerplateQuoteContent.term}": "${quote}"`);
      }
      for (const forbidden of boilerplateQuoteContent.forbidden) {
        if (quote.includes(forbidden)) {
          throw new Error(`quote contains boilerplate "${forbidden}": "${quote}"`);
        }
      }
    },
  },
  {
    name: "duplicate-results: dedupeByUrl drops duplicate URLs before fetch",
    async run() {
      const fetcher = new MockFetcher();
      // Provider that returns the same URL twice (worst-case provider
      // behavior) — the pipeline must still ground cleanly with one citation.
      const dup = {
        id: "dup",
        async search(_q, opts) {
          return duplicateResults.searchResults.slice(0, opts.maxResults);
        },
      };
      const out = await runSearchAndCite(
        { provider: dup, fetcher, maxSources: 5, minTrust: 0.5 },
        { query: "dup" },
      );
      if (!out.grounded) {
        throw new Error(`expected grounded output, got grounded=${out.grounded}`);
      }
      const urls = out.citations.map((c) => c.url);
      if (new Set(urls).size !== urls.length) {
        throw new Error(`duplicate citation URLs escaped the pipeline: ${urls.join(",")}`);
      }
      // The single deduped URL must still be directly fetchable.
      const d = await fetcher.fetch(duplicateResults.url);
      if (!d.text.length) {
        throw new Error("fetched deduped document unexpectedly empty");
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
