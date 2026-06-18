#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const bin = path.join(root, "bin", "clisponsor.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "clisponsor-hook-test-"));

function runRaw(args, options = {}) {
  const { expectedStatus = 0, input = "", env = {}, testHome = home } = options;
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    env: { ...process.env, HOME: testHome, ...env },
    input,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    expectedStatus,
    `${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function run(args, options = {}) {
  const result = runRaw(args, options);
  return result.stdout;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function runNode(args, options = {}) {
  const { expectedStatus = 0, input = "", env = {} } = options;
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, HOME: home, ...env },
    input,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    expectedStatus,
    `${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

try {
  const noLoginHome = fs.mkdtempSync(path.join(os.tmpdir(), "clisponsor-no-login-test-"));
  const help = run(["help"]);
  assert.match(help, /clisponsor add <install-token>/);
  assert.match(help, /clisponsor add --token-file=<path>/);
  assert.doesNotMatch(help, /Legacy compatibility:/);
  assert.doesNotMatch(help, /clisponsor login/);
  assert.doesNotMatch(help, /device-code/);
  assert.doesNotMatch(help, /--serve-api/);
  assert.doesNotMatch(help, /--backend-api/);
  assert.doesNotMatch(help, /install codex/);
  assert.doesNotMatch(help, /install claude/);
  assert.doesNotMatch(help, /install gemini/);
  assert.notEqual(help.indexOf("clisponsor add <install-token>"), -1);

  const statusWithoutLogin = runRaw(["status"], { expectedStatus: 1, testHome: noLoginHome });
  assert.match(statusWithoutLogin.stderr, /clisponsor add <install-token>/);
  assert.doesNotMatch(statusWithoutLogin.stderr, /--code/);

  const addWithoutToken = runRaw(["add"], { expectedStatus: 1, testHome: noLoginHome });
  assert.match(addWithoutToken.stderr, /Missing install token/);
  fs.rmSync(noLoginHome, { recursive: true, force: true });

  writeJson(path.join(home, ".clisponsor", "config.json"), {
    installToken: "legacy-token",
    apiBaseUrl: "https://backend.legacy.test/",
  });
  const migratedDoctor = JSON.parse(run(["doctor", "--json", "--skip-network"]));
  assert.equal(migratedDoctor.serveBaseUrl, "https://serve.clisponsor.com");
  assert.equal(migratedDoctor.backendBaseUrl, "https://backend.legacy.test");
  assert.equal(migratedDoctor.loggedIn, true);

  const legacyLogin = runRaw(["login", "--code=legacy-code"]);
  assert.match(legacyLogin.stderr, /Legacy --code accepted as an install token alias/);
  assert.equal(readJson(path.join(home, ".clisponsor", "config.json")).installToken, "legacy-code");

  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [{ type: "command", command: "node /tmp/keep-me.mjs", timeout: 1 }],
            },
          ],
        },
        statusLine: { type: "command", command: `node ${path.join(home, ".clisponsor", "claude", "clisponsor_statusline.mjs")}` },
      },
      null,
      2,
    ),
  );

  fs.mkdirSync(path.join(home, ".clisponsor", "claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".clisponsor", "claude", "cliads_claude_hook.mjs"), "");
  fs.writeFileSync(path.join(home, ".clisponsor", "claude", "cliads_statusline.mjs"), "");

  run(["add", "test-token", "--serve-api=https://serve.example.test/", "--backend-api=https://backend.example.test/"]);
  const config = readJson(path.join(home, ".clisponsor", "config.json"));
  assert.equal(config.installToken, "test-token");
  assert.equal(config.serveBaseUrl, "https://serve.example.test");
  assert.equal(config.backendBaseUrl, "https://backend.example.test");
  assert.equal(config.apiBaseUrl, "https://serve.example.test");

  const doctor = JSON.parse(run(["doctor", "--json", "--skip-network"]));
  assert.equal(doctor.serveBaseUrl, "https://serve.example.test");
  assert.equal(doctor.backendBaseUrl, "https://backend.example.test");
  assert.equal(doctor.loggedIn, true);
  assert.equal(doctor.network.skipped, true);

  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-plugin", "scripts", "clisponsor_codex_hook.mjs")), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-marketplace", "plugins", "clisponsor")), true);

  const capturePath = path.join(home, "captured-fetch.json");
  const importPath = path.join(home, "mock-fetch.mjs");
  fs.writeFileSync(
    importPath,
    `
import fs from "node:fs";
Date.now = () => 1700000000000;
globalThis.fetch = async (url, options) => {
  fs.writeFileSync(process.env.CLISPONSOR_CAPTURE_PATH, JSON.stringify({ url, ...options }, null, 2));
  return { ok: true, async json() { return { display_line: "Sponsored: test" }; } };
};
`,
  );
  const codexHook = path.join(home, ".clisponsor", "codex-plugin", "scripts", "clisponsor_codex_hook.mjs");
  const hookRun = runNode(["--import", importPath, codexHook, "UserPromptSubmit"], {
    input: JSON.stringify({ prompt: "hello" }),
    env: { CLISPONSOR_CAPTURE_PATH: capturePath },
  });
  assert.match(hookRun.stdout, /Sponsored: test/);
  const capturedFetch = readJson(capturePath);
  const capturedBody = JSON.parse(capturedFetch.body);
  assert.equal(capturedFetch.url, "https://serve.example.test/v1/ads/serve");
  assert.equal(capturedBody.client, "Codex");
  assert.equal(capturedBody.hook_event, "UserPromptSubmit");
  assert.equal(capturedBody.placement, "StartTurn");
  assert.equal(capturedFetch.headers.authorization, "Bearer test-token");
  assert.equal(capturedFetch.headers["x-clisponsor-timestamp"], "1700000000");
  const canonical = [
    "v1",
    capturedFetch.headers["x-clisponsor-timestamp"],
    capturedFetch.headers["x-clisponsor-nonce"],
    capturedBody.client || "",
    capturedBody.hook_event || "",
    capturedBody.placement || "",
    capturedBody.idempotency_key || "",
    capturedBody.user_id || "",
  ].join("\n");
  const signature = crypto.createHmac("sha256", "test-token").update(canonical).digest("hex");
  assert.equal(capturedFetch.headers["x-clisponsor-signature"], `sha256=${signature}`);

  run(["add", "test-token", "--serve-api=https://serve.example.test/", "--backend-api=https://backend.example.test/"]);
  const claudeSettings = readJson(path.join(home, ".claude", "settings.json"));
  assert.equal(claudeSettings.hooks.UserPromptSubmit.length, 2);
  assert.equal(
    claudeSettings.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_claude_hook.mjs")).length,
    1,
  );
  assert.equal(JSON.stringify(claudeSettings).includes("keep-me.mjs"), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "clisponsor_claude_hook.mjs")), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "gemini", "clisponsor_gemini_hook.mjs")), true);

  run(["uninstall", "all", "--config"]);
  const cleanedSettings = readJson(path.join(home, ".claude", "settings.json"));
  assert.equal(JSON.stringify(cleanedSettings).includes("clisponsor_claude_hook.mjs"), false);
  assert.equal(JSON.stringify(cleanedSettings).includes("clisponsor_statusline.mjs"), false);
  assert.equal(JSON.stringify(cleanedSettings).includes("keep-me.mjs"), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-plugin")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-marketplace")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "clisponsor_claude_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "cliads_claude_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "cliads_statusline.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "gemini", "clisponsor_gemini_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "config.json")), false);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
