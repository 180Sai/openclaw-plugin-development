# changes.md — openclaw-search-cite work log

Plugin: `search_and_cite` — web search with grounded, verifiable citations
(the local analogue of "search grounding" in Google AI Studio).

Repo: https://github.com/180Sai/openclaw-plugin-development
Period: 2026-08-18 → 2026-09-18 (22 commits across 6 iteration branches)

---

## 2026-08-18 → 08-29 · Scaffolding & CI bring-up

- **feat(search-cite): scaffold plugin with grounded citations** (`0cb1cc5`)
  - Plugin entry registers the `search_and_cite` agent tool.
  - Source layout: `search.ts` (mock + http provider abstraction), `fetch.ts`
    (redirects, timeouts, text extraction), `pipeline.ts`
    (search → fetch → select → cite → validate), `provenance.ts`
    (evidence-to-claim validation — the grounding core), `scoring.ts`
    (trust scoring, domain filtering, dedup).
  - Two providers via `configSchema`: `mock` (credential-free deterministic
    corpus; proves the pipeline in tests/evals/CI with no API key) and `http`
    (pluggable skeleton for Tavily / SerpAPI / Brave / Bing adapters).
  - Grounding hard rules enforced in code: every citation URL comes from the
    provider result set, was actually fetched (redirect-resolved), and every
    quote is a verbatim substring of the fetched text. `requireGrounding` +
    failure ⇒ `grounded: false` with structured errors — never an unverified
    link.
- **CI fixes** (`5adfe9f`, `80a264c`, `6ff3c36`)
  - CodeQL: granted `contents:read` so checkout could clone, added
    `actions:read` for workflow-run metadata, then dropped the job until
    code scanning was enabled on the repo.
- **fix(pipeline): firstSentence no longer truncates at periods inside URLs**
  (`bd55ef2`) — quotes breaking mid-URL corrupted grounding substrings.
- Merged init scaffold via PR #1 (`7c2217b`).

## 2026-09-05 → 09-10 · Citation quality

- **fix(pipeline): dedupe provider results before fetch** (`ced12eb`)
  — duplicate citations from overlapping provider results.
- **feat(pipeline): select query-relevant citation quotes instead of first
  sentence** (`592e2ff`, PR #4) — quote selection now favors passages that
  actually answer the query.
- **fix(fetch): decode HTML entities in extracted text** (`c106b88`, PR #5)
  — entity-encoded characters broke verbatim-quote grounding checks.
- **fix(fetch): reject binary content-types** (`d355781`, PR #6) — only
  textual pages can be cited.
- **feat(pipeline): fetch provider results with bounded concurrency**
  (`ad68102`, PR #7).

## 2026-09-11 → 09-18 · Robustness & runtime integration

- **feat(tool): structured failure only when `requireGrounding` and grounding
  fails** (`d1dbcb2`) — non-grounded queries no longer hard-fail.
- **feat(search): use OpenClaw runtime web-search provider registry**
  (`298c70f`) — plugin now rides the runtime's provider registry instead of
  its own ad-hoc search path.
- **fix(fetch): retry transient failures** (`16cf78b`) — bounded backoff on
  429/5xx/network errors.
- **fix(fetch): honor Retry-After on 429** (`71ba9e6`, capped at 5s).
- **agent(iter): prefer informative passages over page chrome in quote
  selection** (`632d06d`) — nav/boilerplate no longer wins quote selection.
- **fix(fetch): parse HTTP-date Retry-After form** (`26085c9`) — capped,
  past dates fall back.

---

## Grounding invariants (current)

1. Citation URL ∈ provider result set
2. Citation URL was fetched successfully (final URL after redirects)
3. Quote is verbatim substring of fetched document text
4. Failed provenance + `requireGrounding` ⇒ `grounded: false` + structured
   errors, never an invented link

## Branches

| branch | tip | date |
|---|---|---|
| `main` | 298c70f | 2026-09-15 |
| `agent/init-scaffold` | 5adfe9f | 2026-08-27 |
| `agent/iter-20260911-1400` | 9b361fc | 2026-09-11 |
| `agent/iter-20260915-0545` | d1dbcb2 | 2026-09-15 |
| `agent/iter-20260916-1400` | 928f53a | 2026-09-17 |
| `agent/iter-20260917-1621` | 26085c9 | 2026-09-18 |

Note: `origin/main` (71ba9e6) and `agent/iter-20260916/17` branches are ahead
of local `main` — the retry/Retry-After fixes are on the iteration branches,
not yet merged to `main`.
