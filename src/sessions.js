"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const WORKSPACES_DIR = path.join(__dirname, "..", "workspaces");
const DATA_DIR = path.join(__dirname, "..", "data");
const DATABASE_PATH = path.join(DATA_DIR, "sessions.sqlite");

// Session files are intentionally kept outside the source tree and the small
// SQLite catalog makes their URLs survive a process restart.
fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DATABASE_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );
`);

// Upgrade databases created by the first WebMCP release in place.
try {
  db.exec("ALTER TABLE sessions ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}

const insertSession = db.prepare(
  "INSERT INTO sessions (id, layout_id, created_at, metadata_json) VALUES (?, ?, ?, ?)"
);
const selectSession = db.prepare(
  "SELECT id, layout_id, created_at, metadata_json FROM sessions WHERE id = ?"
);
const selectSessions = db.prepare(
  "SELECT id, layout_id, created_at, metadata_json FROM sessions ORDER BY created_at DESC"
);

function toSession(row) {
  if (!row) return null;
  const dir = path.join(WORKSPACES_DIR, row.id);
  let metadata = {};
  try {
    metadata = JSON.parse(row.metadata_json || "{}");
  } catch {
    // Keep a corrupt optional metadata field from making a design inaccessible.
  }
  return {
    id: row.id,
    layoutId: row.layout_id,
    dir,
    htmlPath: path.join(dir, "index.html"),
    cssPath: path.join(dir, "style.css"),
    createdAt: row.created_at,
    metadata,
  };
}

function create(sessionId, layoutId, metadata = {}) {
  const dir = path.join(WORKSPACES_DIR, sessionId);
  fs.mkdirSync(dir, { recursive: true });

  const createdAt = Date.now();
  insertSession.run(sessionId, layoutId, createdAt, JSON.stringify(metadata));
  return toSession({
    id: sessionId,
    layout_id: layoutId,
    created_at: createdAt,
    metadata_json: JSON.stringify(metadata),
  });
}

function get(sessionId) {
  return toSession(selectSession.get(sessionId));
}

function list() {
  return selectSessions.all().map(toSession);
}

module.exports = { create, get, list, databasePath: DATABASE_PATH };
