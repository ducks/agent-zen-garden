"use strict";

const fs = require("fs");
const path = require("path");

const WORKSPACES_DIR = path.join(__dirname, "..", "workspaces");
const store = new Map();

function create(sessionId, layoutId) {
  const dir = path.join(WORKSPACES_DIR, sessionId);
  fs.mkdirSync(dir, { recursive: true });

  const session = {
    id: sessionId,
    layoutId,
    dir,
    htmlPath: path.join(dir, "index.html"),
    cssPath:  path.join(dir, "style.css"),
    createdAt: Date.now(),
  };

  store.set(sessionId, session);
  return session;
}

function get(sessionId) {
  return store.get(sessionId) ?? null;
}

function list() {
  return Array.from(store.values());
}

module.exports = { create, get, list };
