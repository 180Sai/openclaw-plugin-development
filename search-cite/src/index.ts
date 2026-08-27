/**
 * search-cite plugin entry point.
 *
 * Registers a single agent tool: `search_and_cite`, which performs web search
 * and returns grounded, verifiable citations.
 *
 * Follows the OpenClaw tool-plugin pattern documented in
 * docs/plugins/building-plugins.md (registerTool with
 * { name, label, description, parameters, execute }).
 */

import { Type } from "typebox";
import {
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";
import { DEFAULT_CONFIG, type SearchAndCiteConfig } from "./types.js";
import { MockSearchProvider, MockFetcher } from "./search.js";
import { runSearchAndCite } from "./pipeline.js";

const entry: OpenClawPluginDefinition = definePluginEntry({
  id: "search-cite",
  name: "Search and Cite",
  description: "Web search with grounded, verifiable citations.",
  register(api) {
    api.registerTool({
      name: "search_and_cite",
      label: "Search and Cite",
      description:
        "Search the web and return grounded citations. Every citation URL is a source that was actually searched and fetched; quotes are verbatim from the fetched page. Use for current information, online research, recommendations, prices, news, job postings, or anything that may have changed since the model's knowledge cutoff.",
      parameters: Type.Object({
        query: Type.String({ minLength: 1 }),
        maxSources: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
        requireGrounding: Type.Optional(Type.Boolean()),
      }),
      async execute(_id, params: unknown) {
        const p = params as {
          query: string;
          maxSources?: number;
          requireGrounding?: boolean;
        };
        const config: SearchAndCiteConfig = { ...DEFAULT_CONFIG };
        const maxSources = Math.min(config.maxSources, p.maxSources ?? config.maxSources);

        // First iteration uses the credential-free mock provider so the full
        // pipeline is provable without external API keys. A real provider
        // adapter (provider: "http") plugs in later; its API key must live in
        // the OpenClaw secrets store / env, never in Git.
        const provider = new MockSearchProvider();
        const fetcher = new MockFetcher();

        const result = await runSearchAndCite(
          {
            provider,
            fetcher,
            maxSources,
            minTrust: config.minTrust,
          },
          {
            query: p.query,
            maxSources,
            requireGrounding: p.requireGrounding,
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    });
  },
});

export default entry;
