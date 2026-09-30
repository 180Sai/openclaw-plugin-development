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
import { runSearchAndCite, firstSentence, selectQuote, significantTerms, fetchWithConcurrency } from "../dist/pipeline.js";
import { extractText, extractTitle, isTransientStatus, retryAfterMs, backoffWithJitter } from "../dist/fetch.js";
import { isSupportedTextContentType, isOversizedContentLength, HttpFetcher } from "../dist/fetch.js";
import { fixtureUrlContent } from "../fixtures/url-periods.mjs";
import { strictGroundingFixture } from "../fixtures/strict-grounding.mjs";
import { concurrencyFixture } from "../fixtures/fetch-concurrency.mjs";
import { contentTypeFixture } from "../fixtures/content-type.mjs";
import { queryQuoteContent } from "../fixtures/query-quotes.mjs";
import { duplicateResults } from "../fixtures/duplicate-results.mjs";
import { retryFixture } from "../fixtures/fetch-retry.mjs";
import { boilerplateQuoteContent } from "../fixtures/quote-boilerplate.mjs";
import { entityFixture } from "../fixtures/entity-decoding.mjs";
import { bodyCapFixture } from "../fixtures/body-cap.mjs";
import { urlVariantResults } from "../fixtures/url-variants.mjs";
import { urlSchemeVariantResults } from "../fixtures/url-scheme-variants.mjs";
import { dedupeByUrl } from "../dist/scoring.js";
import { wordBoundaryContent } from "../fixtures/word-boundary.mjs";
import { unicodeTermContent } from "../fixtures/unicode-terms.mjs";
import { diacriticTermContent } from "../fixtures/diacritic-terms.mjs";


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
      // Jitter bounds on the exponential fallback.
      const j = retryFixture.jitter;
      const mid = backoffWithJitter(2, () => 0.5);
      if (mid !== j.attempt2NoJitterMs) throw new Error("jitter midpoint should be the plain backoff");
      if (backoffWithJitter(2, () => 0) !== j.attempt2LowMs) throw new Error("jitter low bound mismatch");
      if (backoffWithJitter(2, () => 1) !== j.attempt2HighMs) throw new Error("jitter high bound mismatch");
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
    name: "body-cap: oversized response bodies are rejected, never truncated or retried",
    async run() {
      const cap = bodyCapFixture.capBytes;
      // Declared oversized Content-Length is rejected on the header alone.
      if (!isOversizedContentLength(bodyCapFixture.oversized.declaredLength, cap)) {
        throw new Error("declared oversized content-length must be flagged");
      }
      if (isOversizedContentLength(String(bodyCapFixture.underCap.bodyChars), cap)) {
        throw new Error("under-cap content-length must not be flagged");
      }
      // Post-read enforcement: server omits Content-Length, body is huge.
      let calls = 0;
      const hangOrig = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response("x".repeat(bodyCapFixture.oversized.undeclaredBodyChars), {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      };
      try {
        const fetcher = new HttpFetcher(1000, 3, cap);
        let rejected = false;
        try {
          await fetcher.fetch("https://example.com/lying");
        } catch (e) {
          rejected = bodyCapFixture.oversized.permanentMsg.test(e instanceof Error ? e.message : String(e));
        }
        if (!rejected) throw new Error("oversized body without content-length must be rejected after read");
        if (calls !== 1) throw new Error(`oversized-body rejection must not be retried (calls=${calls})`);
      } finally {
        globalThis.fetch = hangOrig;
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
    name: "entity-decoding: extractTitle decodes entities like extractText",
    run() {
      const title = extractTitle(entityFixture.titleHtml);
      if (title !== entityFixture.decodedTitle) {
        throw new Error(`title entities not decoded: got "${title}" expected "${entityFixture.decodedTitle}"`);
      }
      if (/&(amp|#\d+|eacute|#x[0-9a-f]+);/i.test(title)) {
        throw new Error(`raw entity leaked into decoded title: "${title}"`);
      }
    },
  },
  {
    name: "entity-decoding: named Latin-1 entities decode in text and titles",
    run() {
      const title = extractTitle(entityFixture.namedTitleHtml);
      if (title !== entityFixture.namedDecodedTitle) {
        throw new Error(`named title entities not decoded: got "${title}" expected "${entityFixture.namedDecodedTitle}"`);
      }
      const text = extractText("<p>Caf&eacute; &amp; Co &mdash; Guide &Auml; &frac12;</p>").toLowerCase();
      if (text !== "café & co — guide ä ½") {
        throw new Error(`named text entities not decoded: "${text}"`);
      }
    }
  },
  {
    name: "word-boundary: selectQuote ignores query terms embedded in longer words",
    run() {
      const text = wordBoundaryContent.normalizedText;
      const quote = selectQuote(text, wordBoundaryContent.query);
      if (!text.includes(quote)) {
        throw new Error(`quote is not a verbatim substring of the page: "${quote}"`);
      }
      if (!quote.includes(wordBoundaryContent.term)) {
        throw new Error(`quote does not contain term "${wordBoundaryContent.term}": "${quote}"`);
      }
      for (const forbidden of wordBoundaryContent.forbidden) {
        if (quote.includes(forbidden)) {
          throw new Error(`quote contains substring-mismatched sentence "${forbidden}": "${quote}"`);
        }
      }
    },
  },
  {
    name: "unicode-terms: accented words are real word boundaries for term matching",
    run() {
      // Accented letters must count as word chars: "art" must NOT match
      // inside "artículo", and the query-level extraction must keep accented
      // terms intact ("café" ≠ "caf").
      const text = unicodeTermContent.normalizedText;
      const quote = selectQuote(text, unicodeTermContent.query);
      if (!text.includes(quote)) {
        throw new Error(`quote is not a verbatim substring of the page: "${quote}"`);
      }
      if (!quote.includes(unicodeTermContent.term)) {
        throw new Error(`quote does not contain term "${unicodeTermContent.term}": "${quote}"`);
      }
      for (const forbidden of unicodeTermContent.forbidden) {
        if (quote.includes(forbidden)) {
          throw new Error(`quote contains substring-mismatched sentence "${forbidden}": "${quote}"`);
        }
      }
      const terms = significantTerms("best café in paris");
      if (!terms.includes("café")) {
        throw new Error(`accented query term was mangled: got ${JSON.stringify(terms)}`);
      }
      if (terms.includes("caf")) {
        throw new Error(`ASCII-truncated term leaked into extraction: ${JSON.stringify(terms)}`);
      }
    },
  },
  {
    name: "diacritic-terms: accent-folded matching surfaces the verbatim accented quote",
    run() {
      // A query written without an accent ("cafe") must match document text
      // containing the accented form ("café") for *relevance & windowing*,
      // but the emitted quote must keep the verbatim accent from the fetched
      // text (provenance preserved). It must also never pick the decoy
      // "cafeteria" (word-boundary still applies after folding).
      const text = diacriticTermContent.normalizedText;
      const quote = selectQuote(text, diacriticTermContent.query);
      if (!text.includes(quote)) {
        throw new Error(`quote is not a verbatim substring of the page: "${quote}"`);
      }
      if (!quote.includes(diacriticTermContent.term)) {
        throw new Error(
          `quote does not contain the verbatim accented term "${diacriticTermContent.term}": "${quote}"`,
        );
      }
      for (const forbidden of diacriticTermContent.forbidden) {
        if (quote.includes(forbidden)) {
          throw new Error(`quote contains decoy "${forbidden}": "${quote}"`);
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
  {
    name: "url-variants: tracking/fragment/trailing-slash variants collapse to one citation",
    async run() {
      // Leaf function: variants of one page collapse; distinct pages survive.
      const urls = urlVariantResults.searchResults.map((r) => r.url);
      const deduped = dedupeByUrl(urls.map((url) => ({ url })));
      if (deduped.length !== 1) {
        throw new Error(`expected 1 deduped URL, got ${deduped.length}: ${deduped.map((d) => d.url).join(",")}`);
      }
      if (deduped[0].url !== urlVariantResults.expectedUrl) {
        throw new Error(`expected canonical ${urlVariantResults.expectedUrl}, got ${deduped[0].url}`);
      }
      // End-to-end: dedupe happens BEFORE fetch, so the same page is never
      // fetched twice and cites exactly the first-returned URL.
      const fetches = [];
      const fetcher = {
        async fetch(url) {
          fetches.push(url);
          if (url === "https://example.com/guide") {
            return {
              url,
              title: "Example Guide",
              text: "the official example guide explains how to configure grounded search and cite primary sources with verifiable evidence.",
              fetchedAt: new Date().toISOString(),
            };
          }
          throw new Error(`unexpected fetch of ${url}`);
        },
      };
      const variant = {
        id: "variants",
        async search() {
          return urlVariantResults.searchResults;
        },
      };
      const out = await runSearchAndCite(
        { provider: variant, fetcher, maxSources: 5, minTrust: 0.5 },
        { query: "guide" },
      );
      if (!out.grounded) {
        throw new Error(`expected grounded output, got grounded=${out.grounded}`);
      }
      if (out.citations.length !== urlVariantResults.expectedCitationCount) {
        throw new Error(`expected ${urlVariantResults.expectedCitationCount} citation, got ${out.citations.length}`);
      }
      if (out.citations[0].url !== urlVariantResults.expectedUrl) {
        throw new Error(`expected citation url ${urlVariantResults.expectedUrl}, got ${out.citations[0].url}`);
      }
      if (fetches.length !== 1 || fetches[0] !== urlVariantResults.expectedUrl) {
        throw new Error(`expected exactly 1 fetch of ${urlVariantResults.expectedUrl}, got ${fetches.join(",")}`);
      }
    },
  },
  {
    name: "url-scheme-variants: http/https, www and default-port variants collapse to one citation",
    async run() {
      const deduped = dedupeByUrl(urlSchemeVariantResults.searchResults.map((r) => ({ url: r.url })));
      if (deduped.length !== 1) {
        throw new Error(`expected 1 deduped URL, got ${deduped.length}: ${deduped.map((d) => d.url).join(",")}`);
      }
      if (deduped[0].url !== urlSchemeVariantResults.expectedUrl) {
        throw new Error(`expected canonical ${urlSchemeVariantResults.expectedUrl}, got ${deduped[0].url}`);
      }
      const fetches = [];
      const fetcher = {
        async fetch(url) {
          fetches.push(url);
          if (url === "https://example.com/release-notes") {
            return {
              url,
              title: "Release Notes",
              text: "the release notes document versioned feature summaries for the current upstream release with grounded evidence and verifiable detail.",
              fetchedAt: new Date().toISOString(),
            };
          }
          throw new Error(`unexpected fetch of ${url}`);
        },
      };
      const variant = {
        id: "scheme-variants",
        async search() {
          return urlSchemeVariantResults.searchResults;
        },
      };
      const out = await runSearchAndCite(
        { provider: variant, fetcher, maxSources: 5, minTrust: 0.5 },
        { query: "release notes" },
      );
      if (!out.grounded) {
        throw new Error(`expected grounded output, got grounded=${out.grounded}`);
      }
      if (out.citations.length !== urlSchemeVariantResults.expectedCitationCount) {
        throw new Error(`expected ${urlSchemeVariantResults.expectedCitationCount} citation, got ${out.citations.length}`);
      }
      if (out.citations[0].url !== urlSchemeVariantResults.expectedUrl) {
        throw new Error(`expected citation url ${urlSchemeVariantResults.expectedUrl}, got ${out.citations[0].url}`);
      }
      if (fetches.length !== 1 || fetches[0] !== urlSchemeVariantResults.expectedUrl) {
        throw new Error(`expected exactly 1 fetch of ${urlSchemeVariantResults.expectedUrl}, got ${fetches.join(",")}`);
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
