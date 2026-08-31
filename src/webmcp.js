"use strict";

// The server owns the implementation of each operation. This thin client-side
// layer makes those operations discoverable to browser agents through the
// standard imperative WebMCP API.

const statusElement = () => document.querySelector("#webmcp-status");

function setStatus(message, fallback = false) {
  const element = statusElement();
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("fallback", fallback);
}

function modelContext() {
  return document.modelContext ?? navigator.modelContext ?? null;
}

async function waitForModelContext() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const context = modelContext();
    if (context?.registerTool) return context;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

async function callEndpoint(endpoint, input = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { error: `Tool endpoint returned ${response.status}` };
  }

  if (!response.ok) throw new Error(payload.error || `Tool endpoint returned ${response.status}`);
  return payload;
}

async function registerTools(context, definitions) {
  for (const definition of definitions) {
    await context.registerTool({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema ?? definition.parameters,
      annotations: ["list_layouts", "examine_layout"].includes(definition.name)
        ? { readOnlyHint: true }
        : undefined,
      execute: (input = {}) => callEndpoint(definition.endpoint, input),
    });
  }
}

async function installWebMcp() {
  const context = await waitForModelContext();
  if (!context) {
    setStatus("Browser fallback", true);
    return;
  }

  try {
    const response = await fetch("/.well-known/mcp.json", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
    const manifest = await response.json();
    await registerTools(context, manifest.tools ?? []);
    setStatus(`WebMCP active · ${(manifest.tools ?? []).length} tools`);
  } catch (error) {
    setStatus("WebMCP unavailable", true);
    console.warn("Agent Zen Garden WebMCP registration failed", error);
  }
}

installWebMcp();
