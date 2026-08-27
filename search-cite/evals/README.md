# Search and Cite — Grounding Evaluation

This directory holds the grounding benchmark used by CI to detect regression.

## What it measures

The eval drives the `search_and_cite` pipeline against a fixed set of fixtures
and asserts the grounding hard rules hold:

1. Every citation URL came from the provider's result set.
2. Every cited URL was fetched.
3. Every quote is a verbatim substring of the fetched document text.
4. No citation is invented by the model.

A regression (grounding score dropping below the threshold) fails the eval CI
job before a change can merge.

## Running

```bash
npm run eval
```

## Adding a fixture

Add HTML/text fixture files under `fixtures/` and a matching entry in the eval
runner's query table so the benchmark covers the new behavior.
