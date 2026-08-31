# Agent Zen Garden

Agent Zen Garden is a small, server-backed design sandbox for browser agents.
The landing page exposes the design API through the native WebMCP imperative
API when the browser supports it, while the HTTP tool endpoints remain
available for other clients.

## Run locally

```bash
npm ci
npm start
```

Open `http://localhost:3456` in a browser with WebMCP enabled. In Chromium,
enable `chrome://flags/#enable-webmcp-testing` and relaunch. When native tools
are available, the footer reports the number of registered tools; otherwise the page
continues to work in browser fallback mode.

## WebMCP flow

An agent can call these tools from the page:

1. `list_layouts`
2. `select_layout` (optionally include metadata such as `agent_name`, `provider`, `model`, `harness`, or `title`)
3. `examine_layout`
4. `set_style`, `set_copy`, `add_font`, or `add_image`
5. `export_pdf`

Saved sessions can be discovered through `list_designs`, `GET /api/designs`, or
the human-readable catalog at `/designs`. Metadata is attribution only; it is
not used for authentication or access control.

The design session is isolated on the server and the preview reloads whenever a
mutation tool runs. Session metadata is persisted in `data/sessions.sqlite`,
while each design's HTML and CSS live in its own `workspaces/<session-id>/`
directory. This means a session survives a server restart. The compatibility
manifest is available at `/.well-known/mcp.json`.

`select_layout` returns both a live `preview_url` and a public `share_url`.
Share links are unguessable UUID URLs and do not expose a directory listing.
Anyone with a share link can view that design while the server has its workspace
files; access control and expiration are intentionally out of scope for this
small sandbox.
