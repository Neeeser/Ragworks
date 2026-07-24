import { describe, expect, it } from "vitest";

import {
  claudeCodeCommand,
  mcpEndpointUrl,
  mcpServersJson,
  serverNameFor,
} from "@/components/mcp/lib/connection";

const COLLECTION_ENDPOINT = "https://rag.example.com/api/mcp/collections/col-1";
const SERVER_NAME = "ragworks-notes";

describe("mcpEndpointUrl", () => {
  it("builds the collection endpoint from the browser origin", () => {
    expect(mcpEndpointUrl("https://rag.example.com", "col-1")).toBe(COLLECTION_ENDPOINT);
  });

  it("does not double the separator when the origin has a trailing slash", () => {
    expect(mcpEndpointUrl("http://localhost:7247/", "col-1")).toBe(
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
    const command = claudeCodeCommand(SERVER_NAME, COLLECTION_ENDPOINT, "rw_secret");

    expect(command).toContain(`--transport http ${COLLECTION_ENDPOINT}`);
    expect(command).toContain('--header "Authorization: Bearer rw_secret"');
  });

  it("emits an http mcpServers entry carrying the key", () => {
    const config = JSON.parse(mcpServersJson(SERVER_NAME, COLLECTION_ENDPOINT, "rw_s")) as {
      mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
    };

    expect(config.mcpServers[SERVER_NAME]).toEqual({
      type: "http",
      url: COLLECTION_ENDPOINT,
      headers: { Authorization: "Bearer rw_s" },
    });
  });
});
