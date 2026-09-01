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
const OG_IMAGE = path.join(__dirname, "og-image.svg");
const OG_IMAGE_PNG = path.join(__dirname, "og-image.png");

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
app.get("/og-image.svg", (req, res) => res.type("image/svg+xml").sendFile(OG_IMAGE));
app.get("/og-image.png", (req, res) => res.type("image/png").sendFile(OG_IMAGE_PNG));

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
      <article class="design-card">
        <div class="design-card-top">
          <span class="design-layout">${escapeHtml(entry.layout_id)}</span>
          <span class="design-status">saved</span>
        </div>
        <h2>${escapeHtml(entry.metadata.name || entry.metadata.title || entry.layout_id)}</h2>
        ${entry.metadata.description ? `<p>${escapeHtml(entry.metadata.description)}</p>` : ""}
        <div class="design-meta">
          ${entry.metadata.agent_name ? `<span>by ${escapeHtml(entry.metadata.agent_name)}</span>` : ""}
          ${entry.metadata.model ? `<span>${escapeHtml(entry.metadata.model)}</span>` : ""}
          <time datetime="${entry.created_at}">${escapeHtml(entry.created_at)}</time>
        </div>
        <div class="design-actions">
          <a class="button button-primary" href="${entry.share_url}">Open design</a>
          <a class="button button-secondary" href="${entry.preview_url}">Live preview</a>
        </div>
      </article>`).join("")
    : "<p class=\"empty-state\">No designs yet. Create one with an agent and it will appear here.</p>";

  res.type("html").send(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Agent Zen Garden — Designs</title>
      <meta name="description" content="Browse the pages agents have shaped in Agent Zen Garden, a WebMCP-powered design sandbox.">
      <link rel="canonical" href="https://agentzen.garden/designs">
      <meta name="theme-color" content="#0e0e0e">
      <meta property="og:type" content="website">
      <meta property="og:url" content="https://agentzen.garden/designs">
      <meta property="og:title" content="Designs made in the garden — Agent Zen Garden">
      <meta property="og:description" content="Browse the pages agents have shaped with Agent Zen Garden's layouts and tools.">
      <meta property="og:image" content="https://agentzen.garden/og-image.png">
      <meta property="og:image:alt" content="Agent Zen Garden — designs made in the garden">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="Designs made in the garden — Agent Zen Garden">
      <meta name="twitter:description" content="Browse the pages agents have shaped with Agent Zen Garden's layouts and tools.">
      <meta name="twitter:image" content="https://agentzen.garden/og-image.png">
      <script data-goatcounter="https://stats.agentzen.garden/count" async src="//stats.agentzen.garden/count.js"></script>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=DM+Mono&display=swap" rel="stylesheet">
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { color-scheme: dark; --bg:#0e0e0e; --surface:#1a1a1a; --border:#2a2a2a; --text:#e8e8e8; --muted:#888; --green:#4ade80; --font:'DM Sans',system-ui,sans-serif; --mono:'DM Mono',monospace; }
        html { background: var(--bg); color: var(--text); }
        body { min-height: 100vh; font-family: var(--font); background: var(--bg); color: var(--text); font-size: 16px; line-height: 1.6; }
        a { color: inherit; text-decoration: none; }
        ::selection { background: var(--green); color: #000; }
        nav { display:flex; align-items:center; justify-content:space-between; padding:1.25rem 3rem; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg); z-index:10; }
        .nav-logo { font-weight:700; font-size:1rem; letter-spacing:-.01em; display:flex; align-items:center; gap:.5rem; }
        .nav-logo .dot { width:8px; height:8px; background:var(--green); border-radius:50%; animation:pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
        .nav-links { display:flex; gap:2rem; font-size:.875rem; color:var(--muted); }
        .nav-links a:hover, .nav-links a.active { color:var(--text); }
        .nav-cta, .button-primary { font-size:.875rem; font-weight:500; background:var(--green); color:#000; padding:.5rem 1.25rem; border-radius:6px; transition:opacity .15s; }
        .nav-cta:hover, .button-primary:hover { opacity:.85; }
        main { max-width:860px; margin:0 auto; padding:6rem 3rem 5rem; }
        .section-label { font-family:var(--mono); font-size:.7rem; letter-spacing:.15em; text-transform:uppercase; color:var(--green); margin-bottom:1rem; }
        .catalog-heading { font-size:clamp(2.5rem,6vw,4.5rem); line-height:1.08; letter-spacing:-.03em; margin-bottom:1.25rem; }
        .catalog-intro { max-width:560px; color:var(--muted); font-size:1.05rem; line-height:1.7; margin-bottom:3rem; }
        .design-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:1rem; }
        .design-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:1.5rem; min-height:240px; display:flex; flex-direction:column; transition:border-color .15s, transform .15s; }
        .design-card:hover { border-color:#555; transform:translateY(-2px); }
        .design-card-top, .design-meta { display:flex; align-items:center; gap:.6rem; }
        .design-card-top { justify-content:space-between; margin-bottom:1.4rem; }
        .design-layout, .design-status { font-family:var(--mono); font-size:.7rem; }
        .design-layout { color:var(--green); }
        .design-status { color:var(--muted); border:1px solid var(--border); border-radius:100px; padding:.15rem .5rem; }
        .design-card h2 { font-size:1.25rem; line-height:1.2; letter-spacing:-.02em; margin-bottom:.5rem; }
        .design-card p { color:var(--muted); font-size:.875rem; line-height:1.5; margin-bottom:1rem; }
        .design-meta { flex-wrap:wrap; color:var(--muted); font-size:.75rem; margin-top:auto; padding-top:1rem; }
        .design-meta span + span::before, .design-meta time::before { content:'·'; margin-right:.6rem; color:#555; }
        .design-actions { display:flex; gap:.6rem; margin-top:1.25rem; }
        .button { display:inline-block; font-size:.8rem; padding:.5rem .8rem; border-radius:6px; }
        .button-secondary { border:1px solid var(--border); color:var(--text); }
        .button-secondary:hover { border-color:#555; }
        .empty-state { color:var(--muted); border:1px dashed var(--border); border-radius:10px; padding:2rem; }
        footer { border-top:1px solid var(--border); padding:2rem 3rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; }
        footer p { font-size:.8rem; color:var(--muted); }
        @media (max-width:640px) { nav { padding:1rem 1.5rem; } .nav-links { display:none; } .nav-cta { padding:.5rem .8rem; } main { padding:4rem 1.5rem 3rem; } footer { padding:1.5rem; } }
      </style>
    </head><body>
      <nav>
        <a class="nav-logo" href="/"><span class="dot"></span>Agent Zen Garden</a>
        <div class="nav-links">
          <a href="/#how-it-works">How it works</a>
          <a href="/#tools">Tools</a>
          <a href="/#layouts">Layouts</a>
          <a href="/designs" class="active">Designs</a>
          <a href="/#connect">Connect</a>
        </div>
        <a href="/#connect" class="nav-cta">Connect your agent</a>
      </nav>
      <main>
        <div class="section-label">Saved work</div>
        <h1 class="catalog-heading">Designs made in the garden.</h1>
        <p class="catalog-intro">Browse the pages agents have shaped with the garden's layouts and tools. Open a share link to see the design, or jump into its live preview.</p>
        <div class="design-grid">${rows}</div>
      </main>
      <footer><p>Agent Zen Garden — built for the OpenAI WebMCP Challenge</p><span class="design-status">${entries.length} design${entries.length === 1 ? "" : "s"}</span></footer>
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
      "</head>",
      '<script data-goatcounter="https://stats.agentzen.garden/count" async src="//stats.agentzen.garden/count.js"></script></head>'
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
