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
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

const cfg = readConfig();
const serveBaseUrl = cfg.serveBaseUrl || cfg.apiBaseUrl;
await readStdin();

try {
  if (!serveBaseUrl || !cfg.userId || !cfg.deviceCode || !cfg.deviceSecret) process.exit(0);
  const placement = PLACEMENTS[EVENT] || "StartTurn";
  const body = {
    user_id: cfg.userId,
    device_code: cfg.deviceCode,
    client: "Codex",
    hook_event: EVENT,
    placement,
    idempotency_key: crypto.randomUUID(),
    metadata: { hookVersion: HOOK_VERSION },
  };
  const res = await fetch(`${serveBaseUrl}/v1/ads/serve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${cfg.deviceSecret}`,
      "x-clisponsor-hook-version": HOOK_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) process.exit(0);
  const ad = await res.json();
  if (ad.display_line) console.log(JSON.stringify({ systemMessage: ad.display_line }));
} catch {
  process.exit(0);
}
