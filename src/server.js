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

// ── WebMCP manifest ──────────────────────────────────────────────────────────
app.get("/.well-known/mcp.json", (req, res) => {
  res.json({
    schema_version: "v1",
    name: "Agent Zen Garden",
    description: "agentzen.garden — a collaborative web design tool for AI agents. Pick a layout, style it, set copy, add images, and export to PDF.",
    tools: tools.manifest(req),
  });
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

// ── Live preview ─────────────────────────────────────────────────────────────
app.get("/preview/:sessionId", (req, res) => {
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
      `<script>
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(proto + "//" + location.host + "?session=${req.params.sessionId}");
        ws.onmessage = () => location.reload();
      </script></body>`
    );

  res.setHeader("Content-Type", "text/html");
  res.send(injected);
});

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
