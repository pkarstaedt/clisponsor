#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const bin = path.join(root, "bin", "clisponsor.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "clisponsor-hook-test-"));

function runRaw(args, options = {}) {
  const { expectedStatus = 0, input = "", env = {}, testHome = home, pathValue = process.env.PATH } = options;
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    env: { ...process.env, HOME: testHome, PATH: pathValue, ...env },
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
  return runRaw(args, options).stdout;
}

function makeFakeBin(commands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clisponsor-bin-"));
  for (const command of commands) {
    const file = path.join(dir, command);
    fs.writeFileSync(
      file,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "${command} test"
  exit 0
fi
exit 0
`,
      { mode: 0o755 },
    );
  }
  return dir;
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
  assert.match(help, /clisponsor install/);
  assert.match(help, /clisponsor login <email>/);
  assert.doesNotMatch(help, /install-token/);
  assert.doesNotMatch(help, /clisponsor add/);
  assert.doesNotMatch(help, /install codex/);
  assert.doesNotMatch(help, /install claude/);
  assert.doesNotMatch(help, /install gemini/);

  const statusWithoutLogin = runRaw(["status"], { expectedStatus: 1, testHome: noLoginHome });
  assert.match(statusWithoutLogin.stderr, /clisponsor login <email>/);

  const loginWithoutEmail = runRaw(["login"], { expectedStatus: 1, testHome: noLoginHome });
  assert.match(loginWithoutEmail.stderr, /Missing email/);
  fs.rmSync(noLoginHome, { recursive: true, force: true });

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
      },
      null,
      2,
    ),
  );

  const loginCapture = path.join(home, "captured-login.json");
  const loginMock = path.join(home, "mock-login-fetch.mjs");
  fs.writeFileSync(
    loginMock,
    `
import fs from "node:fs";
globalThis.fetch = async (url, options) => {
  fs.writeFileSync(process.env.CLISPONSOR_LOGIN_CAPTURE_PATH, JSON.stringify({ url, ...options }, null, 2));
  return {
    ok: true,
    async json() {
      return {
        email: "carterjay@gmail.com",
        user_id: "14825286-e30f-400c-a95e-03e5c59239e0",
        device_code: "sentence-tiger-wonder",
        device_secret: "cls_dev_test-secret",
        label: "Work laptop"
      };
    }
  };
};
`,
  );

  const fakeBin = makeFakeBin(["claude"]);
  const testPath = `${fakeBin}${path.delimiter}${process.env.PATH}`;

  const installOutput = run(["install"], { pathValue: testPath });
  assert.match(installOutput, /Codex CLI plugin/);
  assert.match(installOutput, /Claude Code CLI hook installed/);
  assert.match(installOutput, /Gemini CLI hook script staged/);
  assert.doesNotMatch(installOutput, /Serve API/);
  assert.doesNotMatch(installOutput, /serve\\.clisponsor\\.com/);

  const login = spawnSync(process.execPath, ["--import", loginMock, bin, "login", "carterjay@gmail.com", "--label=Work laptop"], {
    cwd: root,
    env: { ...process.env, HOME: home, CLISPONSOR_LOGIN_CAPTURE_PATH: loginCapture },
    encoding: "utf8",
  });
  assert.equal(login.status, 0, `${login.stdout}\n${login.stderr}`);
  assert.match(login.stdout, /Device code: sentence-tiger-wonder/);
  const capturedLogin = readJson(loginCapture);
  assert.equal(capturedLogin.url, "https://backend.clisponsor.com/v1/cli/login");
  assert.deepEqual(JSON.parse(capturedLogin.body), {
    email: "carterjay@gmail.com",
    label: "Work laptop",
    serve_base_url: "https://serve.clisponsor.com",
  });

  const config = readJson(path.join(home, ".clisponsor", "config.json"));
  assert.equal(config.email, "carterjay@gmail.com");
  assert.equal(config.userId, "14825286-e30f-400c-a95e-03e5c59239e0");
  assert.equal(config.deviceCode, "sentence-tiger-wonder");
  assert.equal(config.deviceSecret, "cls_dev_test-secret");
  assert.equal(config.deviceLabel, "Work laptop");
  assert.equal(config.installToken, undefined);

  const doctor = JSON.parse(run(["doctor", "--json", "--skip-network"]));
  assert.equal(doctor.loggedIn, true);
  assert.equal(doctor.email, "carterjay@gmail.com");
  assert.equal(doctor.deviceCode, "sentence-tiger-wonder");
  assert.equal(doctor.network.skipped, true);

  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-plugin", "scripts", "clisponsor_codex_hook.mjs")), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-marketplace", "plugins", "clisponsor")), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "clisponsor_claude_hook.mjs")), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "gemini", "clisponsor_gemini_hook.mjs")), true);

  const hookCapture = path.join(home, "captured-hook.json");
  const hookMock = path.join(home, "mock-hook-fetch.mjs");
  fs.writeFileSync(
    hookMock,
    `
import fs from "node:fs";
globalThis.fetch = async (url, options) => {
  fs.writeFileSync(process.env.CLISPONSOR_HOOK_CAPTURE_PATH, JSON.stringify({ url, ...options }, null, 2));
  return { ok: true, async json() { return { display_line: "Sponsored: test" }; } };
};
`,
  );
  const codexHook = path.join(home, ".clisponsor", "codex-plugin", "scripts", "clisponsor_codex_hook.mjs");
  const hookRun = runNode(["--import", hookMock, codexHook, "UserPromptSubmit"], {
    input: JSON.stringify({ prompt: "do not capture this" }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  assert.match(hookRun.stdout, /Sponsored: test/);
  const capturedHook = readJson(hookCapture);
  const capturedBody = JSON.parse(capturedHook.body);
  assert.equal(capturedHook.url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(capturedHook.headers.authorization, "Bearer cls_dev_test-secret");
  assert.equal(capturedHook.headers["x-clisponsor-signature"], undefined);
  assert.equal(capturedBody.user_id, "14825286-e30f-400c-a95e-03e5c59239e0");
  assert.equal(capturedBody.device_code, "sentence-tiger-wonder");
  assert.equal(capturedBody.client, "Codex");
  assert.equal(capturedBody.hook_event, "UserPromptSubmit");
  assert.equal(capturedBody.placement, "StartTurn");
  assert.equal(capturedBody.metadata.hookInput, undefined);
  assert.equal(JSON.stringify(capturedBody).includes("do not capture this"), false);

  run(["install"], { pathValue: testPath });
  const claudeSettings = readJson(path.join(home, ".claude", "settings.json"));
  assert.equal(claudeSettings.hooks.UserPromptSubmit.length, 2);
  assert.equal(
    claudeSettings.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_claude_hook.mjs")).length,
    1,
  );
  assert.equal(JSON.stringify(claudeSettings).includes("keep-me.mjs"), true);

  run(["uninstall", "all", "--config"]);
  const cleanedSettings = readJson(path.join(home, ".claude", "settings.json"));
  assert.equal(JSON.stringify(cleanedSettings).includes("clisponsor_claude_hook.mjs"), false);
  assert.equal(JSON.stringify(cleanedSettings).includes("keep-me.mjs"), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-plugin")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-marketplace")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "clisponsor_claude_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "gemini", "clisponsor_gemini_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "config.json")), false);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
