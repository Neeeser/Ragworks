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
export function claudeCodeCommand(serverName: string, endpoint: string, secret: string): string {
  return [
    `claude mcp add ${serverName} \\`,
    `  --transport http ${endpoint} \\`,
    `  --header "Authorization: Bearer ${secret}"`,
  ].join("\n");
}

/** The generic `mcpServers` JSON block most harnesses accept. */
export function mcpServersJson(serverName: string, endpoint: string, secret: string): string {
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
