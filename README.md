# openclaw-plugin-development

A repository for iteratively developing new OpenClaw plugins.

## Plugins

| Directory | Plugin | Description |
|-----------|--------|-------------|
| `search-cite/` | search-cite | Web search with grounded, verifiable citations (`search_and_cite` tool). |

Each plugin is self-contained under its own directory with its own `package.json`
and CI coverage. See `search-cite/README.md` for details.

## CI / CD

GitHub Actions workflows live in `.github/workflows/`:

- `ci.yml` — lint, typecheck, build, unit tests, and grounding eval on
  push/PR.
- `eval.yml` — scheduled (every 6h) + PR grounding-score drift check; the
  eval report is uploaded as a CI artifact.

## Branch model

- `main` — reviewed, deployable.
- `agent/*` — iterative improvement branches opened by the hourly automation.
- PRs required for merges; changes to grounding/provenance or search logic are
  human-reviewed, low-risk changes may auto-merge once CI passes.
