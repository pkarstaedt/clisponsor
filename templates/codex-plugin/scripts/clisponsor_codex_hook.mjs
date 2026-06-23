#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";

const CONFIG_PATH = "__CLISPONSOR_CONFIG_PATH__";
const HOOK_VERSION = "1.0.0";
const EVENT = process.argv[2] || "UserPromptSubmit";
const PLACEMENTS = {
  SessionStart: "StartSession",
  UserPromptSubmit: "StartTurn",
  Stop: "EndTurn",
};

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function sponsoredLine(line, forwardDisplayUrl = "") {
  return `[Sponsored] ${line}${forwardDisplayUrl ? ` | ${forwardDisplayUrl}` : ""}`;
}

function responseMessage(ad) {
  return ad.display_line ? sponsoredLine(ad.display_line, ad.forward_display_url) : ad.message || "";
}

const cfg = readConfig();
const serveBaseUrl = cfg.serveBaseUrl || cfg.apiBaseUrl;
await readStdin();

try {
  const placement = PLACEMENTS[EVENT] || "StartTurn";
  const authenticated = Boolean(cfg.userId && cfg.deviceCode && cfg.deviceSecret);
  if (!serveBaseUrl || (!authenticated && placement !== "StartSession")) process.exit(0);
  const body = {
    user_id: cfg.userId || null,
    device_code: cfg.deviceCode || null,
    client: "Codex",
    hook_event: EVENT,
    placement,
    idempotency_key: crypto.randomUUID(),
    metadata: { hookVersion: HOOK_VERSION },
  };
  const headers = {
    "content-type": "application/json",
    "x-clisponsor-hook-version": HOOK_VERSION,
  };
  if (cfg.deviceSecret) headers.authorization = `Bearer ${cfg.deviceSecret}`;
  const res = await fetch(`${serveBaseUrl}/v1/ads/serve`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) process.exit(0);
  const ad = await res.json();
  const message = responseMessage(ad);
  if (message) console.log(JSON.stringify({ systemMessage: message }));
} catch {
  process.exit(0);
}
