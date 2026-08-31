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
are available, the footer reports `WebMCP active · 8 tools`; otherwise the page
continues to work in browser fallback mode.

## WebMCP flow

An agent can call these tools from the page:

1. `list_layouts`
2. `select_layout`
3. `examine_layout`
4. `set_style`, `set_copy`, `add_font`, or `add_image`
5. `export_pdf`

The design session is isolated on the server and the preview reloads whenever a
mutation tool runs. The compatibility manifest is available at
`/.well-known/mcp.json`.

