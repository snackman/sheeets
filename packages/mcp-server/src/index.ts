#!/usr/bin/env node

/**
 * @sheeets/mcp — MCP server for the sheeets crypto event discovery API.
 *
 * Reads the SHEEETS_API_KEY environment variable for authenticated endpoints
 * (itinerary, friends, RSVPs, recommendations). Public endpoints (event
 * search, conferences, tags) work without a key.
 *
 * Usage:
 *   SHEEETS_API_KEY=shts_... npx @sheeets/mcp
 *
 * Or configure in Claude Code / Claude Desktop:
 *   {
 *     "mcpServers": {
 *       "sheeets": {
 *         "command": "npx",
 *         "args": ["@sheeets/mcp"],
 *         "env": { "SHEEETS_API_KEY": "shts_..." }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SheeetsAPI } from "./api.js";
import { registerTools } from "./tools.js";

const apiKey = process.env.SHEEETS_API_KEY;
const baseUrl = process.env.SHEEETS_API_URL; // Optional override

if (!apiKey) {
  process.stderr.write(
    "Warning: SHEEETS_API_KEY not set. Only public endpoints (search_events, list_conferences, list_tags, list_dates, get_event) will work.\n"
  );
}

const api = new SheeetsAPI(apiKey, baseUrl);

const server = new McpServer(
  {
    name: "sheeets",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

registerTools(server, api);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
