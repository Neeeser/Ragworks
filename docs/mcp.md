# MCP access

Every collection is reachable as an MCP server, so the pipelines you build and
test in Ragworks can be called from any agent harness that speaks the Model
Context Protocol.

- **Endpoint:** `POST /api/mcp/collections/{collection_id}`
- **Transport:** Streamable HTTP, stateless (single JSON responses, no session id)
- **Protocol revisions:** `2025-11-25`, `2025-06-18`, `2025-03-26`
- **Authentication:** `Authorization: Bearer <api key>`

## Connecting an agent

A collection's Overview page has an **MCP** card showing its endpoint and the
keys that reach it. **Connect an agent** issues a key and shows the connection
details once, with the key filled in, for Claude Code, Codex, Cursor, VS Code,
the OpenAI Responses API, and any other client. Account-wide key management (what
exists, when each was last used, revocation) is in **Settings → API keys**.

```
claude mcp add ragworks-handbook \
  --transport http https://ragworks.example.com/api/mcp/collections/<collection-id> \
  --header "Authorization: Bearer rw_…"
```

```json
{
  "mcpServers": {
    "ragworks-handbook": {
      "type": "http",
      "url": "https://ragworks.example.com/api/mcp/collections/<collection-id>",
      "headers": { "Authorization": "Bearer rw_…" }
    }
  }
}
```

Two clients want a different shape and fail quietly when given the block above:
VS Code keys its servers under `servers` rather than `mcpServers`, and Codex
reads TOML (`~/.codex/config.toml`), where an entry with a `url` is an HTTP
server:

```toml
[mcp_servers.ragworks-handbook]
url = "https://ragworks.example.com/api/mcp/collections/<collection-id>"
http_headers = { Authorization = "Bearer rw_…" }
```

(`codex mcp add` takes a token only as `--bearer-token-env-var`, so a key pasted
literally goes in the file.)

Nothing here is Ragworks-specific past the URL and the header, so a client with
no published snippet needs no adapter — the dialog's **Any client** tab is the
same request as a runnable `curl`, useful for checking the connection before
wiring a client to it.

One collection is one MCP server is one key. The endpoint path decides which
collection an agent sees — `serverInfo.name` is the collection's slug and
`initialize`'s `instructions` carry its description, so a harness's server entry
*is* the collection and an agent knows what corpus it is talking to without a
discovery call — and the key issued alongside it reaches that collection and
nothing else. Connecting five collections is five server entries and five keys,
each revocable on its own.

There is deliberately no "every collection" grant. Reach that widens by itself
means a key issued today silently covers corpora that did not exist when it was
reviewed, and it turns one leaked secret into every collection. A credential that
spans collections belongs to a workspace-level server, not to a collection's own
key.

## Keys and scope

A key is issued per user and carries two scopes:

- **Capabilities** — what the bearer may do: `tools:invoke`, `files:read`,
  `files:write`. `files:write` grants `files:read` with it, because an agent that
  may upload or delete has to be able to find what it is acting on.
- **Collections** — the explicit list the key was issued for, fixed at creation.

Both are enforced on every request. Each MCP tool declares the capability it
needs, and the tool set is filtered per request, so a capability you did not
grant is **absent from `tools/list`** rather than present-but-refused. A key
pointed at a collection outside its scope gets the same `404` as a collection
that does not exist, so the URL cannot be used to enumerate anything.

Keys authenticate the MCP endpoint only — never the REST API, never chat. Only
the sha256 digest is stored: the secret is shown once at creation and is
unrecoverable, so a lost key is revoked and reissued. Revoked keys keep their row
as an audit record.

`features.mcp_access` (admin settings) switches the endpoint off for the whole
deployment; existing keys stay valid and start working again when it is switched
back on.

## Tools

`tools:invoke` exposes the collection's **enabled tool bindings** — the same
projection Chat Studio advertises, so a tool behaves identically whether a model
calls it here or in the platform. Chunk-returning tools publish a result schema
and return `structuredContent` alongside a readable text rendering; structured
tools (count, facet) return their declared output fields.

`files:read` adds `list_files`, `read_file`, and `search_files`; `files:write`
adds `upload_file`, `delete_file`, and `create_folder`. Uploads are queued for
ingestion by the collection's own ingest pipeline, exactly like a browser upload,
and file content travels as UTF-8 text or base64 (`encoding: "base64"`) because
MCP tool arguments are JSON. Deleting is annotated destructive so a harness can
require confirmation.

Every call runs through `ToolInvocationService`, the platform's single
pipeline-invocation path, so agent traffic records a query event and a run trace
just like a query from the UI — an MCP call is as inspectable as any other.

## Errors

Protocol faults are JSON-RPC errors (unknown method, unknown tool, malformed
body). Failures *inside* a tool — a bad path, an invalid argument, a pipeline
error — come back as a result with `isError: true` and a readable message, so the
calling model can correct itself instead of seeing a transport failure.

## Testing it

The `mcp-connected` sandbox scenario seeds a collection with ingested documents
plus a full-capability key, and prints the endpoint and key in its handoff:

```
uv run python -m sandbox up mcp-connected
```

Conformance is checked at two levels. `tests/mcp/` pins the transport rules
hermetically (version negotiation, notification `202`, `GET`/`DELETE` `405`,
`Origin` rejection, the JSON-RPC-vs-tool-error split). Against a running
sandbox, the endpoint is driven by real clients — the official `mcp` Python SDK,
`npx @modelcontextprotocol/inspector --cli`, and `claude mcp add` — which is
what makes "works in any harness" an observation rather than a claim. The saved
browser flow `frontend/flows/mcp-connected/` covers the UI path end to end,
including that a UI-issued key serves exactly the tools its capabilities allow.
