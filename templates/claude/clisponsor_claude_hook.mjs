#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const HOOK_VERSION = "1.0.0";
const event = process.argv[2] || "UserPromptSubmit";
const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".clisponsor", "config.json"), "utf8"));
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

await readStdin();

try {
  if (!serveBaseUrl || !cfg.userId || !cfg.deviceCode || !cfg.deviceSecret) process.exit(0);
  const body = {
    user_id: cfg.userId,
    device_code: cfg.deviceCode,
    client: "ClaudeCode",
    hook_event: event,
    placement: placements[event] || "StartTurn",
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
  if (ad.display_line) console.log(JSON.stringify({ systemMessage: sponsoredLine(ad.display_line) }));
} catch {
  process.exit(0);
}
