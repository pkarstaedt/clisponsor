#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const HOOK_VERSION = "1.0.0";
const event = process.argv[2] || "UserPromptSubmit";
const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".clisponsor", "config.json"), "utf8"));
const serveBaseUrl = cfg.serveBaseUrl || cfg.apiBaseUrl;

function signedHeaders(body) {
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

try {
  if (!serveBaseUrl || !cfg.installToken) process.exit(0);
  const body = {
    client: "ClaudeCode",
    hook_event: event,
    placement: event === "SessionStart" ? "StartSession" : event === "Stop" ? "EndTurn" : "StartTurn",
    idempotency_key: crypto.randomUUID(),
    metadata: { hookVersion: HOOK_VERSION },
  };
  await fetch(`${serveBaseUrl}/v1/ads/serve`, {
    method: "POST",
    headers: signedHeaders(body),
    body: JSON.stringify(body),
  });
} catch {}
