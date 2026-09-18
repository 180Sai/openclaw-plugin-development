# openclaw-search-cite

OpenClaw plugin that adds a `search_and_cite` agent tool: **web search with
grounded, verifiable citations** — the local analogue of "search grounding" in
Google AI Studio.

## What it does

`search_and_cite(query, maxSources?, requireGrounding?)` searches the web,
fetches the top results, and returns:

- an `answer`
- a `grounded` flag
- a `citations[]` array, where every entry is a **verified** source

Results are deduplicated before fetching, fetched with bounded concurrency
(4 at a time), and scored for trust before any citation is built. Quote
selection prefers informative, query-relevant passages over page chrome —
nav/boilerplate text (menus, cookie notices, "sign in", footer links) is
penalized so the citation quote actually supports the answer it is attached
to.

## Grounding hard rules (enforced in code)

1. Every citation URL appears in the search provider's returned result set.
2. Every cited URL was successfully fetched (redirect-resolved final URL).
3. Every `quote` is a verbatim substring of the fetched document's extracted
   text (HTML entities are decoded first, so quotes read naturally and still
   validate).
4. If grounding is required (`requireGrounding`) and any claim fails
   provenance, the tool returns a structured failure only — `grounded: false`
   with an `errors[]` array and no prose answer that could be mistaken for a
   verified claim. Without `requireGrounding`, a non-grounded result is
   returned with `grounded: false` instead of hard-failing.

The model can never invent a citation URL; links are produced only from sources
the tool actually searched for and fetched.

## Search providers

Search goes through a provider abstraction. At runtime the plugin prefers
whatever web-search provider the OpenClaw gateway is configured with; without
that surface (unit tests, CI) it falls back to the credential-free mock.

| provider | Purpose |
|----------|---------|
| `openclaw` (default when available) | Wraps the OpenClaw runtime web-search registry — the same provider machinery behind the core `web_search` tool (SearXNG, DuckDuckGo, Brave, Tavily, Gemini, ...). Provider selection, credentials, and retries stay in core; this plugin never sees a search API key. Empty/unshaped provider output raises a structured error — never fabricated or padded results. |
| `mock` (fallback/tests) | Credential-free, deterministic corpus. Proves the full search→fetch→cite pipeline in tests, evals, and CI without any API key. |
| `http` | Pluggable real-search skeleton. Adapters for Tavily / SerpAPI / Brave / Bing belong here; their keys stay in the OpenClaw secrets store / env, never in Git. |

Fetching is always real when searching live: the `HttpFetcher` opens and
parses the actual pages so citations are grounded in fetched text. It follows
redirects, enforces a 10s timeout, retries transient failures (429/5xx,
network errors) with bounded exponential backoff (2 retries, 250ms base),
honors server-provided `Retry-After` headers on 429 (both delay-seconds and
HTTP-date forms; values capped at 5s so a hostile server cannot stall a
fetch), rejects binary content-types (only textual pages can be cited), and
decodes HTML entities before quote validation.

## Layout

```text
src/index.ts           plugin entry — registers search_and_cite
src/openclaw-search.ts OpenClaw runtime web-search provider adapter
src/search.ts          provider abstraction (mock + http skeleton)
src/fetch.ts           page retrieval (redirects, timeouts, retries,
                       Retry-After, content-type gating, text extraction)
src/pipeline.ts        search → fetch → select → quote → cite → validate
src/provenance.ts      evidence-to-claim validation (the grounding core)
src/scoring.ts         trust scoring + domain filtering + dedup
src/types.ts           shared types
tests/                 vitest unit tests (incl. grounding invariants)
evals/                 grounding benchmark runner (CI-gated)
fixtures/              eval fixture pages
```

## Development

```bash
npm install
npm run lint      # eslint
npm run typecheck # tsc --noEmit
npm run build     # tsc -> dist/
npm test          # vitest
npm run eval      # grounding benchmark (must stay at 100%)
npm run check     # all of the above
```

## Installing into OpenClaw

Once built and installed (see the OpenClaw docs on plugins), the tool is
exposed to agents as `search_and_cite`. Add a companion skill so agents know
when to call it — e.g. for anything that may have changed since the model's
knowledge cutoff — and to require a `search_and_cite` citation for every
externally verifiable claim.

## Security notes

- Provider credentials must live in the OpenClaw host secrets store or env,
  never in Git, source, package.json, README, chat, or command line.
- Fetched page text is treated as untrusted content; extract it as data, never
  as instructions.
