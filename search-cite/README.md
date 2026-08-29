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

## Grounding hard rules (enforced in code)

1. Every citation URL appears in the search provider's returned result set.
2. Every cited URL was successfully fetched (redirect-resolved final URL).
3. Every `quote` is a verbatim substring of the fetched document's extracted text.
4. If grounding is required and any claim fails provenance, the tool returns
   `grounded: false` with structured errors — never an unverified link.

The model can never invent a citation URL; links are produced only from sources
the tool actually searched for and fetched.

## Providers

This first iteration ships two providers through the plugin `configSchema`
(`provider`, `maxSources`, `minTrust`):

| provider | Purpose |
|----------|---------|
| `mock` (default) | Credential-free, deterministic corpus. Proves the full search→fetch→cite pipeline in tests, evals, and CI without any API key. |
| `http` | Pluggable real-search skeleton. Adapters for Tavily / SerpAPI / Brave / Bing belong here; their keys stay in the OpenClaw secrets store / env, never in Git. |

## Layout

```text
src/index.ts         plugin entry — registers search_and_cite
src/search.ts        provider abstraction (mock + http)
src/fetch.ts         page retrieval (redirects, timeouts, text extraction)
src/extract.ts       (reserved) passage extraction
src/pipeline.ts      search → fetch → select → cite → validate
src/provenance.ts    evidence-to-claim validation (the grounding core)
src/scoring.ts       trust scoring + domain filtering + dedup
src/types.ts         shared types
tests/               vitest unit tests (incl. grounding invariants)
evals/               grounding benchmark runner (CI-gated)
fixtures/            eval fixture pages
.github/workflows/   CI + grounding-eval pipelines
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
