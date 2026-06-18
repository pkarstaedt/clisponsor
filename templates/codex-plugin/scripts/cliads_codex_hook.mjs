#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";

const CONFIG_PATH = "__CLIADS_CONFIG_PATH__";
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

function signedHeaders(cfg, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const canonical = [
    "v1",
    timestamp,
    nonce,
    body.client || "",
    body.hook_event || "",
    body.placement || "",
    body.idempotency_key || "",
    body.user_id || "",
  ].join("\n");
  const signature = crypto.createHmac("sha256", cfg.installToken).update(canonical).digest("hex");
  return {
    "content-type": "application/json",
    authorization: `Bearer ${cfg.installToken}`,
    "x-clisponsor-timestamp": timestamp,
    "x-clisponsor-nonce": nonce,
    "x-clisponsor-signature": `sha256=${signature}`,
    "x-clisponsor-hook-version": HOOK_VERSION,
  };
}

const cfg = readConfig();
const serveBaseUrl = cfg.serveBaseUrl || cfg.apiBaseUrl;
const stdin = await readStdin();
let hookInput = {};
try {
  hookInput = stdin ? JSON.parse(stdin) : {};
} catch {
  hookInput = { raw: stdin };
}

try {
  if (!serveBaseUrl || !cfg.installToken) process.exit(0);
  const placement = PLACEMENTS[EVENT] || "StartTurn";
  const body = {
    client: "Codex",
    hook_event: EVENT,
    placement,
    idempotency_key: crypto.randomUUID(),
    metadata: { hookInput, hookVersion: HOOK_VERSION },
  };
  const res = await fetch(`${serveBaseUrl}/v1/ads/serve`, {
    method: "POST",
    headers: signedHeaders(cfg, body),
    body: JSON.stringify(body),
  });
  if (!res.ok) process.exit(0);
  const ad = await res.json();
  if (EVENT === "Stop") process.exit(0);
  if (ad.display_line) console.log(JSON.stringify({ systemMessage: ad.display_line }));
} catch {
  process.exit(0);
}
