import { describe, expect, it } from "vitest";

import {
  anyClientRequest,
  claudeCodeCommand,
  codexConfigToml,
  mcpEndpointUrl,
  mcpServersJson,
  openAiResponsesTool,
  serverNameFor,
  vsCodeMcpJson,
} from "@/components/mcp/lib/connection";
import { HARNESSES } from "@/components/mcp/lib/harnesses";

const COLLECTION_ENDPOINT = "https://rag.example.com/api/mcp/collections/col-1";
const SERVER_NAME = "ragworks-notes";
const CONFIG = { serverName: SERVER_NAME, endpoint: COLLECTION_ENDPOINT, secret: "rw_s" };

describe("mcpEndpointUrl", () => {
  it("uses the browser origin when the API is same-origin (the Docker image)", () => {
    expect(mcpEndpointUrl("https://rag.example.com", "col-1", "")).toBe(COLLECTION_ENDPOINT);
  });

  it("uses the configured API base when it differs from the page (dev mode)", () => {
    // Dev serves the frontend on :3000 and the API on :8000; the agent must be
    // pointed at the API, not the page.
    expect(mcpEndpointUrl("http://localhost:3000", "col-1", "http://localhost:8000")).toBe(
      "http://localhost:8000/api/mcp/collections/col-1",
    );
  });

  it("does not double the separator when the base has a trailing slash", () => {
    expect(mcpEndpointUrl("http://localhost:7247/", "col-1", "")).toBe(
      "http://localhost:7247/api/mcp/collections/col-1",
    );
  });
});

describe("serverNameFor", () => {
  it("reduces a collection name to an identifier a harness can namespace", () => {
    expect(serverNameFor("Field Notes 2026!")).toBe("ragworks-field-notes-2026");
  });

  it("falls back when a name has no usable characters", () => {
    expect(serverNameFor("***")).toBe("ragworks");
  });
});

describe("client configuration", () => {
  it("passes the key as an Authorization header in the CLI command", () => {
    const command = claudeCodeCommand({ ...CONFIG, secret: "rw_secret" });

    expect(command).toContain(`--transport http ${COLLECTION_ENDPOINT}`);
    expect(command).toContain('--header "Authorization: Bearer rw_secret"');
  });

  it("emits an http mcpServers entry carrying the key", () => {
    const config = JSON.parse(mcpServersJson(CONFIG)) as {
      mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
    };

    expect(config.mcpServers[SERVER_NAME]).toEqual({
      type: "http",
      url: COLLECTION_ENDPOINT,
      headers: { Authorization: "Bearer rw_s" },
    });
  });

  it("keys the VS Code block under servers, not mcpServers", () => {
    // VS Code ignores an `mcpServers` block entirely — pasting the generic one
    // registers nothing and reports no error.
    const config = JSON.parse(vsCodeMcpJson(CONFIG)) as Record<string, unknown>;

    expect(Object.keys(config)).toEqual(["servers"]);
    expect(config.servers).toEqual({
      [SERVER_NAME]: {
        type: "http",
        url: COLLECTION_ENDPOINT,
        headers: { Authorization: "Bearer rw_s" },
      },
    });
  });

  it("passes the bare secret in the Responses API authorization field", () => {
    // The Responses API adds the `Bearer` scheme itself; including it here
    // sends `Bearer Bearer …`.
    const tool = JSON.parse(openAiResponsesTool(CONFIG)) as {
      type: string;
      server_label: string;
      server_url: string;
      authorization: string;
    };

    expect(tool.type).toBe("mcp");
    expect(tool.server_label).toBe(SERVER_NAME);
    expect(tool.server_url).toBe(COLLECTION_ENDPOINT);
    expect(tool.authorization).toBe("rw_s");
  });

  it("declares the Codex server in TOML with a literal header", () => {
    // Codex reads TOML, so the JSON blocks are not merely differently shaped —
    // they are unparseable there.
    const toml = codexConfigToml(CONFIG);

    expect(toml).toContain(`[mcp_servers.${SERVER_NAME}]`);
    expect(toml).toContain(`url = "${COLLECTION_ENDPOINT}"`);
    expect(toml).toContain('http_headers = { Authorization = "Bearer rw_s" }');
  });

  it("gives an unlisted client a runnable request", () => {
    const request = anyClientRequest(CONFIG);

    expect(request).toContain(`curl -X POST ${COLLECTION_ENDPOINT}`);
    expect(request).toContain('"Authorization: Bearer rw_s"');
    expect(request).toContain('"MCP-Protocol-Version: 2025-11-25"');
    expect(request).toContain('"method":"tools/list"');
  });

  it.each(HARNESSES)("$label config carries the endpoint and the key", (harness) => {
    const snippet = harness.snippet({ ...CONFIG, secret: "rw_secret" });

    expect(snippet).toContain(COLLECTION_ENDPOINT);
    expect(snippet).toContain("rw_secret");
  });
});
