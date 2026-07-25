import {
  anyClientRequest,
  claudeCodeCommand,
  codexConfigToml,
  mcpServersJson,
  openAiResponsesTool,
  vsCodeMcpJson,
} from "@/components/mcp/lib/connection";

import type { McpClientConfig } from "@/components/mcp/lib/connection";

/**
 * The clients Ragworks publishes ready-to-paste MCP setup for.
 *
 * Each one's configuration differs in a way that silently fails when guessed —
 * VS Code keys servers under `servers`, Codex is TOML, the Responses API takes
 * the token in a field rather than a header — so the snippet is generated per
 * client instead of offering one block and a list of caveats. The `any` entry is
 * not a fallback for a missing integration: the endpoint is ordinary Streamable
 * HTTP, so it is the whole contract, and the named entries above it are only
 * convenience.
 */

export type HarnessId = "claude-code" | "codex" | "cursor" | "vscode" | "openai" | "any";

export interface HarnessOption {
  id: HarnessId;
  label: string;
  /** Where the snippet goes — the one thing the snippet cannot state itself. */
  hint: string;
  snippet: (config: McpClientConfig) => string;
}

export const HARNESSES: HarnessOption[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    hint: "Run in the project the collection should be available in, or add --scope user for every project.",
    snippet: claudeCodeCommand,
  },
  {
    id: "codex",
    label: "Codex",
    hint: "~/.codex/config.toml. Codex reads MCP servers from TOML, not JSON.",
    snippet: codexConfigToml,
  },
  {
    id: "cursor",
    label: "Cursor",
    hint: "~/.cursor/mcp.json. This is also the block most other harnesses accept.",
    snippet: mcpServersJson,
  },
  {
    id: "vscode",
    label: "VS Code",
    hint: ".vscode/mcp.json, or the user configuration from the MCP: Open User Configuration command.",
    snippet: vsCodeMcpJson,
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "One entry in the Responses API tools array.",
    snippet: openAiResponsesTool,
  },
  {
    id: "any",
    label: "Any client",
    hint: "Streamable HTTP, stateless — no session id to track. Any MCP client works from the URL and that header alone; run this to check the connection before wiring one up.",
    snippet: anyClientRequest,
  },
];
