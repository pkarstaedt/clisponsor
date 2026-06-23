#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const HOOK_VERSION = "1.0.0";
const event = process.argv[2] || "UserPromptSubmit";
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".clisponsor", "config.json"), "utf8"));
} catch {}
const serveBaseUrl = cfg.serveBaseUrl || cfg.apiBaseUrl;
const placements = {
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

function sponsoredLine(line) {
  return `[Sponsored] ${line}`;
}

function responseMessage(ad) {
  return ad.display_line ? sponsoredLine(ad.display_line) : ad.message || "";
}

await readStdin();

try {
  const placement = placements[event] || "StartTurn";
  const authenticated = Boolean(cfg.userId && cfg.deviceCode && cfg.deviceSecret);
  if (!serveBaseUrl || (!authenticated && placement !== "StartSession")) process.exit(0);
  const body = {
    user_id: cfg.userId || null,
    device_code: cfg.deviceCode || null,
    client: "ClaudeCode",
    hook_event: event,
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
