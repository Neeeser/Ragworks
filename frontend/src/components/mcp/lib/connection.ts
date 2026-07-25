import type { ApiKeyCapability } from "@/lib/types/api-keys";
import type { UUID } from "@/lib/types/common";

/**
 * MCP connection details: the endpoint URL and the ready-to-paste client
 * configuration for it. Pure functions so both the collection dialog and the
 * settings panel render identical instructions.
 */

/** One capability, as the picker presents it. */
export interface CapabilityOption {
  value: ApiKeyCapability;
  label: string;
  description: string;
}

export const CAPABILITY_OPTIONS: CapabilityOption[] = [
  {
    value: "tools:invoke",
    label: "Run tools",
    description: "Call the collection's bound retrieval, count, and facet pipelines.",
  },
  {
    value: "files:read",
    label: "Read files",
    description: "List folders, read file contents, and search file names.",
  },
  {
    value: "files:write",
    label: "Write files",
    description: "Upload and delete files and folders. Uploads are ingested.",
  },
];

/**
 * Everything a client configuration is built from.
 *
 * An object rather than three positional strings: the three are all strings and
 * a swapped pair would produce a plausible-looking snippet no compiler catches.
 */
export interface McpClientConfig {
  serverName: string;
  endpoint: string;
  secret: string;
}

/** The protocol revision the published snippets pin. */
export const LATEST_PROTOCOL_VERSION = "2025-11-25";

/**
 * Build the MCP endpoint URL for a collection.
 *
 * The agent must reach the *API*, and which origin serves it depends on the
 * runtime mode: in Docker the frontend proxies same-origin `/api/*`
 * (`apiBaseUrl` is empty, so the browser origin is right), while in dev
 * `NEXT_PUBLIC_API_BASE_URL` points straight at the backend on another port.
 * Showing the browser origin unconditionally hands a dev user a URL nothing
 * answers on.
 */
export function mcpEndpointUrl(origin: string, collectionId: UUID, apiBaseUrl: string): string {
  const base = (apiBaseUrl || origin).replace(/\/$/, "");
  return `${base}/api/mcp/collections/${collectionId}`;
}

/** The `claude mcp add` command for an endpoint. */
export function claudeCodeCommand({ serverName, endpoint, secret }: McpClientConfig): string {
  return [
    `claude mcp add ${serverName} \\`,
    `  --transport http ${endpoint} \\`,
    `  --header "Authorization: Bearer ${secret}"`,
  ].join("\n");
}

/**
 * The Codex `config.toml` entry.
 *
 * Codex declares MCP servers in TOML rather than JSON, and an HTTP server is
 * one with a `url`; `http_headers` carries literal header values.
 */
export function codexConfigToml({ serverName, endpoint, secret }: McpClientConfig): string {
  return [
    `[mcp_servers.${serverName}]`,
    `url = "${endpoint}"`,
    `http_headers = { Authorization = "Bearer ${secret}" }`,
  ].join("\n");
}

/** The generic `mcpServers` JSON block Cursor and most other harnesses accept. */
export function mcpServersJson({ serverName, endpoint, secret }: McpClientConfig): string {
  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    },
    null,
    2,
  );
}

/**
 * The VS Code `mcp.json` block.
 *
 * VS Code keys its servers under `servers`, not `mcpServers` — pasting the
 * generic block there silently registers nothing.
 */
export function vsCodeMcpJson({ serverName, endpoint, secret }: McpClientConfig): string {
  return JSON.stringify(
    {
      servers: {
        [serverName]: {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    },
    null,
    2,
  );
}

/**
 * The OpenAI Responses API tool entry.
 *
 * The bearer token goes in `authorization` as the bare secret — the API adds
 * the `Bearer` scheme itself.
 */
export function openAiResponsesTool({ serverName, endpoint, secret }: McpClientConfig): string {
  return JSON.stringify(
    {
      type: "mcp",
      server_label: serverName,
      server_url: endpoint,
      authorization: secret,
      require_approval: "never",
    },
    null,
    2,
  );
}

/**
 * The raw request every MCP client makes, as a runnable `curl`.
 *
 * There is nothing Ragworks-specific to configure beyond the URL and the
 * header, and a client with no published snippet needs to see exactly that —
 * so the generic case is a request the user can run before wiring anything up.
 */
export function anyClientRequest({ endpoint, secret }: McpClientConfig): string {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  return [
    `curl -X POST ${endpoint} \\`,
    `  -H "Authorization: Bearer ${secret}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Accept: application/json, text/event-stream" \\`,
    `  -H "MCP-Protocol-Version: ${LATEST_PROTOCOL_VERSION}" \\`,
    `  -d '${body}'`,
  ].join("\n");
}

/**
 * Reduce a collection name to a server name a harness will accept.
 *
 * Harnesses namespace tool calls by server name (`mcp__<server>__<tool>`), so
 * the name must survive as an identifier: lowercase, dashes, no leading or
 * trailing separator.
 */
export function serverNameFor(collectionName: string): string {
  const slug = collectionName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `ragworks-${slug}` : "ragworks";
}
