"use strict";

const express = require("express");
const { WebSocketServer } = require("ws");
const { createServer } = require("http");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const sessions = require("./sessions");
const tools = require("./tools");

const LANDING_PAGE = path.join(__dirname, "landing.html");
const WEBMCP_SCRIPT = path.join(__dirname, "webmcp.js");

const app = express();
// Behind Caddy: trust X-Forwarded-Proto so req.protocol reports https,
// making manifest tool URLs correct on the deployed domain.
app.set("trust proxy", true);
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// Track WebSocket clients by sessionId for live reload
const clients = new Map(); // sessionId -> Set<ws>

wss.on("connection", (ws, req) => {
  const sessionId = new URL(req.url, "http://x").searchParams.get("session");
  if (!sessionId) { ws.close(); return; }
  if (!clients.has(sessionId)) clients.set(sessionId, new Set());
  clients.get(sessionId).add(ws);
  ws.on("close", () => clients.get(sessionId)?.delete(ws));
});

function broadcast(sessionId, event) {
  clients.get(sessionId)?.forEach(ws => {
    if (ws.readyState === 1) ws.send(JSON.stringify(event));
  });
}

// ── Landing page ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.sendFile(LANDING_PAGE));
app.get("/webmcp.js", (req, res) => res.type("application/javascript").sendFile(WEBMCP_SCRIPT));

// ── WebMCP manifest ──────────────────────────────────────────────────────────
app.get("/.well-known/mcp.json", (req, res) => {
  res.json({
    schema_version: "v1",
    name: "Agent Zen Garden",
    description: "agentzen.garden — a collaborative web design tool for AI agents. Pick a layout, style it, set copy, add images, and export to PDF.",
    tools: tools.manifest(req),
  });
});

function designEntries() {
  return sessions.list()
    .filter(session => fs.existsSync(session.htmlPath))
    .map(session => ({
      session_id: session.id,
      layout_id: session.layoutId,
      created_at: new Date(session.createdAt).toISOString(),
      metadata: session.metadata,
      preview_url: `/preview/${session.id}`,
      share_url: `/share/${session.id}`,
    }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

app.get("/api/designs", (req, res) => res.json({ designs: designEntries() }));

app.get("/designs", (req, res) => {
  const entries = designEntries();
  const rows = entries.length
    ? entries.map(entry => `
      <li>
        <a href="${entry.share_url}">${escapeHtml(entry.metadata.title || entry.layout_id)}</a>
        ${entry.metadata.agent_name ? `<span>by ${escapeHtml(entry.metadata.agent_name)}</span>` : ""}
        <time datetime="${entry.created_at}">${escapeHtml(entry.created_at)}</time>
        <a href="${entry.preview_url}">preview</a>
      </li>`).join("")
    : "<li>No designs yet.</li>";

  res.type("html").send(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Agent Zen Garden — Designs</title>
      <style>
        :root { color-scheme: dark; font-family: system-ui, sans-serif; }
        body { max-width: 50rem; margin: 4rem auto; padding: 0 1.25rem; background: #171518; color: #f4eef4; }
        a { color: #a7d9d5; }
        li { display: flex; gap: 1rem; align-items: baseline; padding: .8rem 0; border-bottom: 1px solid #3c363e; }
        time { color: #aaa1aa; font-size: .85rem; flex: 1; }
      </style>
    </head><body><p><a href="/">Agent Zen Garden</a></p>
      <h1>Designs</h1><ul>${rows}</ul>
    </body></html>`);
});

// ── Tool endpoint ────────────────────────────────────────────────────────────
app.post("/mcp/tool/:toolName", async (req, res) => {
  const { toolName } = req.params;
  const handler = tools.handlers[toolName];
  if (!handler) {
    return res.status(404).json({ error: `Unknown tool: ${toolName}` });
  }
  try {
    const result = await handler(req.body, { sessions, broadcast });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Live preview and share links ────────────────────────────────────────────
function renderPreview(req, res) {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).send("Session not found");

  const html = fs.readFileSync(session.htmlPath, "utf8");
  const css = fs.existsSync(session.cssPath)
    ? fs.readFileSync(session.cssPath, "utf8")
    : "";

  // Inject live-reload script and inline the current CSS
  const injected = html
    .replace(
      '<link rel="stylesheet" href="style.css">',
      `<style>${css}</style>`
    )
    .replace(
      "</body>",
      `<script src="/webmcp.js" defer></script>
      <script>
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(proto + "//" + location.host + "?session=${req.params.sessionId}");
        ws.onmessage = () => location.reload();
      </script></body>`
    );

  res.setHeader("Content-Type", "text/html");
  res.send(injected);
}

app.get("/preview/:sessionId", renderPreview);
// A stable, explicit public URL for sharing a design with another person.
// Session ids are unguessable UUIDs; no directory listing is exposed.
app.get("/share/:sessionId", renderPreview);

// ── Static assets (uploaded images) ─────────────────────────────────────────
app.use("/assets/:sessionId", (req, res, next) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).end();
  express.static(session.dir)(req, res, next);
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3456;
httpServer.listen(PORT, () => {
  console.log(`Agent Zen Garden running on http://localhost:${PORT}`);
});
