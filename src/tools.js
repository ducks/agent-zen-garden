"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { JSDOM } = require("jsdom");

const LAYOUTS_DIR = path.join(__dirname, "..", "layouts");
const layoutIndex = JSON.parse(fs.readFileSync(path.join(LAYOUTS_DIR, "index.json"), "utf8"));

// ── Helpers ──────────────────────────────────────────────────────────────────

function readSession(sessions, sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

function readCSS(session) {
  return fs.existsSync(session.cssPath)
    ? fs.readFileSync(session.cssPath, "utf8")
    : "";
}

function writeCSS(session, css) {
  fs.writeFileSync(session.cssPath, css, "utf8");
}

// Append or replace a rule block for a selector in the CSS string
function upsertRule(css, selector, declarations) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleRegex = new RegExp(
    `(${escapedSelector}\\s*\\{)[^}]*(\\})`,
    "s"
  );

  const declBlock = Object.entries(declarations)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  const newRule = `${selector} {\n${declBlock}\n}`;

  if (ruleRegex.test(css)) {
    // Merge: parse existing declarations and overlay new ones
    const existingMatch = css.match(ruleRegex);
    const existingDecls = {};
    existingMatch[0].replace(/([a-z-]+)\s*:\s*([^;]+);/g, (_, k, v) => {
      existingDecls[k.trim()] = v.trim();
    });
    const merged = { ...existingDecls, ...declarations };
    const mergedBlock = Object.entries(merged)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
    return css.replace(ruleRegex, `${selector} {\n${mergedBlock}\n}`);
  }

  return css + "\n\n" + newRule;
}

// ── Tool handlers ────────────────────────────────────────────────────────────

const handlers = {};

// list_layouts
handlers.list_layouts = async (_params, _ctx) => {
  return {
    layouts: layoutIndex.map(({ id, name, description, sections }) => ({
      id, name, description, sections,
    })),
  };
};

// select_layout
handlers.select_layout = async ({ layout_id }, { sessions, broadcast }) => {
  const layout = layoutIndex.find(l => l.id === layout_id);
  if (!layout) throw new Error(`Unknown layout: ${layout_id}`);

  const sessionId = randomUUID();
  const session = sessions.create(sessionId, layout_id);

  // Copy layout HTML into workspace
  const html = fs.readFileSync(path.join(LAYOUTS_DIR, layout.file), "utf8");
  fs.writeFileSync(session.htmlPath, html, "utf8");

  // Seed an empty CSS file
  writeCSS(session, `/* ${layout.name} — agent-generated styles */\n`);

  return {
    session_id: sessionId,
    layout: layout.name,
    preview_url: `/preview/${sessionId}`,
    message: `Session created. Visit /preview/${sessionId} to see the live canvas. Use examine_layout to see available slots and selectors.`,
  };
};

// examine_layout
handlers.examine_layout = async ({ session_id }, { sessions }) => {
  const session = readSession(sessions, session_id);
  const html = fs.readFileSync(session.htmlPath, "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Collect all elements with a class or data-slot
  const slots = [];
  doc.querySelectorAll("[data-slot]").forEach(el => {
    slots.push({
      slot: el.getAttribute("data-slot"),
      element: el.tagName.toLowerCase(),
      selector: el.className
        ? `.${el.className.trim().split(/\s+/).join(".")}`
        : el.tagName.toLowerCase(),
      current_text: el.textContent.trim().slice(0, 80) || null,
    });
  });

  // Collect unique CSS classes present
  const classes = new Set();
  doc.querySelectorAll("[class]").forEach(el => {
    el.className.trim().split(/\s+/).forEach(c => classes.add(`.${c}`));
  });

  return {
    session_id,
    layout_id: session.layoutId,
    slots,
    selectors: Array.from(classes).sort(),
    current_css: readCSS(session),
  };
};

// set_style
handlers.set_style = async ({ session_id, selector, declarations }, { sessions, broadcast }) => {
  const session = readSession(sessions, session_id);
  if (!selector) throw new Error("selector is required");
  if (!declarations || typeof declarations !== "object") throw new Error("declarations must be an object");

  let css = readCSS(session);
  css = upsertRule(css, selector, declarations);
  writeCSS(session, css);
  broadcast(session_id, { type: "reload" });

  return {
    ok: true,
    selector,
    declarations,
    message: `Styles applied to ${selector}.`,
  };
};

// add_font
handlers.add_font = async ({ session_id, font_name, google_font }, { sessions, broadcast }) => {
  const session = readSession(sessions, session_id);

  let css = readCSS(session);

  if (google_font) {
    const importStatement = `@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(google_font)}&display=swap');\n`;
    if (!css.includes(importStatement)) {
      css = importStatement + css;
    }
  }

  writeCSS(session, css);
  broadcast(session_id, { type: "reload" });

  return {
    ok: true,
    font_name,
    google_font: google_font ?? null,
    usage: `font-family: '${font_name}', sans-serif;`,
    message: `Font '${font_name}' added. Use set_style with font-family to apply it to selectors.`,
  };
};

// set_copy
handlers.set_copy = async ({ session_id, slot, text }, { sessions, broadcast }) => {
  const session = readSession(sessions, session_id);

  let html = fs.readFileSync(session.htmlPath, "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const el = doc.querySelector(`[data-slot="${slot}"]`);
  if (!el) throw new Error(`Slot not found: ${slot}`);

  el.textContent = text;
  fs.writeFileSync(session.htmlPath, dom.serialize(), "utf8");
  broadcast(session_id, { type: "reload" });

  return {
    ok: true,
    slot,
    text,
    message: `Slot '${slot}' updated.`,
  };
};

// add_image
handlers.add_image = async ({ session_id, slot, url, alt }, { sessions, broadcast }) => {
  const session = readSession(sessions, session_id);

  let html = fs.readFileSync(session.htmlPath, "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const el = doc.querySelector(`[data-slot="${slot}"]`);
  if (!el) throw new Error(`Slot not found: ${slot}`);

  if (el.tagName.toLowerCase() === "img") {
    el.setAttribute("src", url);
    if (alt) el.setAttribute("alt", alt);
  } else {
    // Apply as CSS background via a generated class
    el.style.backgroundImage = `url('${url}')`;
  }

  fs.writeFileSync(session.htmlPath, dom.serialize(), "utf8");
  broadcast(session_id, { type: "reload" });

  return {
    ok: true,
    slot,
    url,
    message: `Image applied to slot '${slot}'.`,
  };
};

// export_pdf
handlers.export_pdf = async ({ session_id }, { sessions }) => {
  const session = readSession(sessions, session_id);

  // Lazy-load puppeteer so it doesn't block startup
  const puppeteer = require("puppeteer");
  // In production (Nix), PUPPETEER_EXECUTABLE_PATH points at the chromium
  // from the flake so we don't rely on puppeteer's bundled download.
  const launchOpts = { args: ["--no-sandbox"] };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();

  const html = fs.readFileSync(session.htmlPath, "utf8");
  const css = readCSS(session);
  const injected = html.replace(
    '<link rel="stylesheet" href="style.css">',
    `<style>${css}</style>`
  );

  await page.setContent(injected, { waitUntil: "networkidle0" });
  const pdfPath = path.join(session.dir, "export.pdf");
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  await browser.close();

  return {
    ok: true,
    pdf_path: pdfPath,
    download_url: `/assets/${session_id}/export.pdf`,
    message: `PDF exported. Download at /assets/${session_id}/export.pdf`,
  };
};

// ── WebMCP manifest ──────────────────────────────────────────────────────────

function manifest(req) {
  const base = `${req.protocol}://${req.get("host")}`;

  const definitions = [
    {
      name: "list_layouts",
      description: "List available layout templates. Always call this first to see what layouts are available.",
      parameters: { type: "object", properties: {}, required: [] },
      endpoint: `${base}/mcp/tool/list_layouts`,
    },
    {
      name: "select_layout",
      description: "Create a new design session with a chosen layout. Returns a session_id and preview_url.",
      parameters: {
        type: "object",
        properties: {
          layout_id: { type: "string", description: "The layout id from list_layouts." },
        },
        required: ["layout_id"],
      },
      endpoint: `${base}/mcp/tool/select_layout`,
    },
    {
      name: "examine_layout",
      description: "Inspect the current HTML structure of a session — lists all slots (editable text/image regions) and CSS selectors available for styling.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session id from select_layout." },
        },
        required: ["session_id"],
      },
      endpoint: `${base}/mcp/tool/examine_layout`,
    },
    {
      name: "set_style",
      description: "Apply CSS declarations to a selector in the session's stylesheet. Merges with any existing rules for that selector.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          selector: { type: "string", description: "CSS selector, e.g. '.hero-headline' or 'body'." },
          declarations: {
            type: "object",
            description: "CSS property/value pairs, e.g. { \"color\": \"#ff0000\", \"font-size\": \"2rem\" }.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["session_id", "selector", "declarations"],
      },
      endpoint: `${base}/mcp/tool/set_style`,
    },
    {
      name: "add_font",
      description: "Load a Google Font into the session and make it available for use with set_style.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          font_name: { type: "string", description: "The font name as it appears in CSS, e.g. 'Playfair Display'." },
          google_font: { type: "string", description: "The Google Fonts family name, e.g. 'Playfair+Display:ital,wght@0,400;1,400'." },
        },
        required: ["session_id", "font_name"],
      },
      endpoint: `${base}/mcp/tool/add_font`,
    },
    {
      name: "set_copy",
      description: "Set the text content of a named slot in the layout.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          slot: { type: "string", description: "Slot name from examine_layout, e.g. 'hero-headline'." },
          text: { type: "string", description: "The new text content." },
        },
        required: ["session_id", "slot", "text"],
      },
      endpoint: `${base}/mcp/tool/set_copy`,
    },
    {
      name: "add_image",
      description: "Set an image URL for an image slot or apply a background image to any slot.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          slot: { type: "string", description: "Slot name from examine_layout." },
          url: { type: "string", description: "Publicly accessible image URL." },
          alt: { type: "string", description: "Alt text for the image." },
        },
        required: ["session_id", "slot", "url"],
      },
      endpoint: `${base}/mcp/tool/add_image`,
    },
    {
      name: "export_pdf",
      description: "Render the current session state to a PDF and return a download URL.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
        },
        required: ["session_id"],
      },
      endpoint: `${base}/mcp/tool/export_pdf`,
    },
  ];

  // Keep the original `parameters` field for the HTTP manifest consumers while
  // also exposing the standard WebMCP name used by document.modelContext.
  return definitions.map(tool => ({ ...tool, inputSchema: tool.parameters }));
}

module.exports = { handlers, manifest };
