#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const HOOK_VERSION = "1.0.0";
const event = process.argv[2] || "UserPromptSubmit";
const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".clisponsor", "config.json"), "utf8"));
const serveBaseUrl = cfg.serveBaseUrl || cfg.apiBaseUrl;

try {
  if (!serveBaseUrl || !cfg.userId || !cfg.deviceCode) process.exit(0);
  const body = {
    user_id: cfg.userId,
    device_code: cfg.deviceCode,
    client: "ClaudeCode",
    hook_event: event,
    placement: event === "SessionStart" ? "StartSession" : event === "Stop" ? "EndTurn" : "StartTurn",
    idempotency_key: crypto.randomUUID(),
    metadata: { hookVersion: HOOK_VERSION },
  };
  await fetch(`${serveBaseUrl}/v1/ads/serve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-clisponsor-hook-version": HOOK_VERSION,
    },
    body: JSON.stringify(body),
  });
} catch {}
