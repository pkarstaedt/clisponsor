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
  assert.match(help, /codex/);
  assert.match(help, /claude/);
  assert.match(help, /gemini/);
  assert.match(help, /antigravity/);

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
  const testPath = fakeBin;

  const installOutput = run(["install"], { pathValue: testPath });
  assert.match(installOutput, /Codex CLI not found/);
  assert.match(installOutput, /Claude Code CLI hook installed/);
  assert.match(installOutput, /Gemini CLI not found/);
  assert.match(installOutput, /Antigravity CLI not found/);
  assert.doesNotMatch(installOutput, /Codex CLI plugin installed/);
  assert.doesNotMatch(installOutput, /Gemini CLI hook installed/);
  assert.doesNotMatch(installOutput, /Antigravity CLI hook installed/);
  assert.equal(fs.existsSync(path.join(home, ".gemini", "settings.json")), false);
  assert.equal(fs.existsSync(path.join(home, ".gemini", "config", "hooks.json")), false);
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

  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-plugin", "scripts", "clisponsor_codex_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-marketplace", "plugins", "clisponsor")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "clisponsor_claude_hook.mjs")), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "gemini", "clisponsor_gemini_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "antigravity", "clisponsor_antigravity_hook.mjs")), false);

  const hookCapture = path.join(home, "captured-hook.json");
  const hookMock = path.join(home, "mock-hook-fetch.mjs");
  fs.writeFileSync(
    hookMock,
    `
import fs from "node:fs";
globalThis.fetch = async (url, options) => {
  fs.writeFileSync(process.env.CLISPONSOR_HOOK_CAPTURE_PATH, JSON.stringify({ url, ...options }, null, 2));
  return { ok: true, async json() { return { display_line: "Test sponsor line" }; } };
};
`,
  );
  const fakeBinWithCodex = makeFakeBin(["codex"]);
  const codexInstallOutput = run(["install", "codex"], { pathValue: fakeBinWithCodex });
  assert.match(codexInstallOutput, /Codex CLI plugin installed/);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-plugin", "scripts", "clisponsor_codex_hook.mjs")), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-marketplace", "plugins", "clisponsor")), true);
  const codexHook = path.join(home, ".clisponsor", "codex-plugin", "scripts", "clisponsor_codex_hook.mjs");
  const hookRun = runNode(["--import", hookMock, codexHook, "UserPromptSubmit"], {
    input: JSON.stringify({ prompt: "do not capture this" }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  assert.deepEqual(JSON.parse(hookRun.stdout), { systemMessage: "[Sponsored] Test sponsor line" });
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

  const claudeHook = path.join(home, ".clisponsor", "claude", "clisponsor_claude_hook.mjs");
  const claudeHookRun = runNode(["--import", hookMock, claudeHook, "UserPromptSubmit"], {
    input: JSON.stringify({ prompt: "do not capture this either" }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  assert.deepEqual(JSON.parse(claudeHookRun.stdout), { systemMessage: "[Sponsored] Test sponsor line" });
  const capturedClaudeHook = readJson(hookCapture);
  const capturedClaudeBody = JSON.parse(capturedClaudeHook.body);
  assert.equal(capturedClaudeHook.url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(capturedClaudeHook.headers.authorization, "Bearer cls_dev_test-secret");
  assert.equal(capturedClaudeBody.user_id, "14825286-e30f-400c-a95e-03e5c59239e0");
  assert.equal(capturedClaudeBody.device_code, "sentence-tiger-wonder");
  assert.equal(capturedClaudeBody.client, "ClaudeCode");
  assert.equal(capturedClaudeBody.hook_event, "UserPromptSubmit");
  assert.equal(capturedClaudeBody.placement, "StartTurn");
  assert.equal(capturedClaudeBody.metadata.hookInput, undefined);
  assert.equal(JSON.stringify(capturedClaudeBody).includes("do not capture this either"), false);

  run(["install"], { pathValue: testPath });
  const claudeSettings = readJson(path.join(home, ".claude", "settings.json"));
  assert.equal(claudeSettings.hooks.UserPromptSubmit.length, 2);
  assert.equal(
    claudeSettings.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_claude_hook.mjs")).length,
    1,
  );
  assert.equal(JSON.stringify(claudeSettings).includes("keep-me.mjs"), true);

  fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
  writeJson(path.join(home, ".gemini", "settings.json"), {
    hooks: {
      BeforeAgent: [
        {
          matcher: "*",
          hooks: [{ name: "keep-gemini", type: "command", command: "node /tmp/keep-gemini.mjs" }],
        },
      ],
    },
  });
  const fakeBinWithGemini = makeFakeBin(["claude", "gemini"]);
  const testPathWithGemini = fakeBinWithGemini;
  const geminiInstallOutput = run(["install", "gemini"], { pathValue: testPathWithGemini });
  assert.match(geminiInstallOutput, /Gemini CLI hook installed/);
  assert.doesNotMatch(geminiInstallOutput, /configure it to run/);
  const geminiHook = path.join(home, ".clisponsor", "gemini", "clisponsor_gemini_hook.mjs");
  const geminiHookRun = runNode(["--import", hookMock, geminiHook, "BeforeAgent"], {
    input: JSON.stringify({ prompt: "do not capture this for gemini" }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  assert.deepEqual(JSON.parse(geminiHookRun.stdout), { systemMessage: "[Sponsored] Test sponsor line" });
  const capturedGeminiHook = readJson(hookCapture);
  const capturedGeminiBody = JSON.parse(capturedGeminiHook.body);
  assert.equal(capturedGeminiHook.url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(capturedGeminiHook.headers.authorization, "Bearer cls_dev_test-secret");
  assert.equal(capturedGeminiBody.user_id, "14825286-e30f-400c-a95e-03e5c59239e0");
  assert.equal(capturedGeminiBody.device_code, "sentence-tiger-wonder");
  assert.equal(capturedGeminiBody.client, "Gemini");
  assert.equal(capturedGeminiBody.hook_event, "BeforeAgent");
  assert.equal(capturedGeminiBody.placement, "StartTurn");
  assert.equal(capturedGeminiBody.metadata.hookInput, undefined);
  assert.equal(JSON.stringify(capturedGeminiBody).includes("do not capture this for gemini"), false);
  const geminiSettings = readJson(path.join(home, ".gemini", "settings.json"));
  assert.equal(JSON.stringify(geminiSettings).includes("keep-gemini.mjs"), true);
  assert.equal(
    geminiSettings.hooks.SessionStart.filter((entry) => JSON.stringify(entry).includes("clisponsor_gemini_hook.mjs")).length,
    1,
  );
  assert.equal(
    geminiSettings.hooks.BeforeAgent.filter((entry) => JSON.stringify(entry).includes("clisponsor_gemini_hook.mjs")).length,
    1,
  );
  assert.equal(
    geminiSettings.hooks.AfterAgent.filter((entry) => JSON.stringify(entry).includes("clisponsor_gemini_hook.mjs")).length,
    1,
  );
  run(["install"], { pathValue: testPathWithGemini });
  const geminiSettingsAfterReinstall = readJson(path.join(home, ".gemini", "settings.json"));
  assert.equal(
    geminiSettingsAfterReinstall.hooks.BeforeAgent.filter((entry) => JSON.stringify(entry).includes("clisponsor_gemini_hook.mjs")).length,
    1,
  );

  fs.mkdirSync(path.join(home, ".gemini", "config"), { recursive: true });
  writeJson(path.join(home, ".gemini", "config", "hooks.json"), {
    hooks: {
      BeforeAgent: [
        {
          matcher: "*",
          hooks: [{ name: "keep-antigravity", type: "command", command: "node /tmp/keep-antigravity.mjs" }],
        },
      ],
    },
  });
  const fakeBinWithAntigravity = makeFakeBin(["agy"]);
  const antigravityInstallOutput = run(["install", "antigravity"], { pathValue: fakeBinWithAntigravity });
  assert.match(antigravityInstallOutput, /Antigravity CLI hook installed/);
  const antigravityHook = path.join(home, ".clisponsor", "antigravity", "clisponsor_antigravity_hook.mjs");
  const antigravityHookRun = runNode(["--import", hookMock, antigravityHook, "UserPromptSubmit"], {
    input: JSON.stringify({ prompt: "do not capture this for antigravity" }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  assert.deepEqual(JSON.parse(antigravityHookRun.stdout), { decision: "allow", systemMessage: "[Sponsored] Test sponsor line" });
  const capturedAntigravityHook = readJson(hookCapture);
  const capturedAntigravityBody = JSON.parse(capturedAntigravityHook.body);
  assert.equal(capturedAntigravityHook.url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(capturedAntigravityHook.headers.authorization, "Bearer cls_dev_test-secret");
  assert.equal(capturedAntigravityBody.client, "Antigravity");
  assert.equal(capturedAntigravityBody.hook_event, "UserPromptSubmit");
  assert.equal(capturedAntigravityBody.placement, "StartTurn");
  assert.equal(JSON.stringify(capturedAntigravityBody).includes("do not capture this for antigravity"), false);
  const antigravityHooks = readJson(path.join(home, ".gemini", "config", "hooks.json"));
  assert.equal(JSON.stringify(antigravityHooks).includes("keep-antigravity.mjs"), true);
  assert.equal(
    antigravityHooks.hooks.PreInvocation.filter((entry) => JSON.stringify(entry).includes("clisponsor_antigravity_hook.mjs")).length,
    1,
  );
  assert.equal(
    antigravityHooks.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_antigravity_hook.mjs")).length,
    1,
  );
  assert.equal(
    antigravityHooks.hooks.PostInvocation.filter((entry) => JSON.stringify(entry).includes("clisponsor_antigravity_hook.mjs")).length,
    1,
  );
  assert.equal(
    antigravityHooks.hooks.Stop.filter((entry) => JSON.stringify(entry).includes("clisponsor_antigravity_hook.mjs")).length,
    1,
  );
  run(["install", "agy"], { pathValue: fakeBinWithAntigravity });
  const antigravityHooksAfterReinstall = readJson(path.join(home, ".gemini", "config", "hooks.json"));
  assert.equal(
    antigravityHooksAfterReinstall.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_antigravity_hook.mjs")).length,
    1,
  );

  run(["uninstall", "all", "--config"]);
  const cleanedSettings = readJson(path.join(home, ".claude", "settings.json"));
  assert.equal(JSON.stringify(cleanedSettings).includes("clisponsor_claude_hook.mjs"), false);
  assert.equal(JSON.stringify(cleanedSettings).includes("keep-me.mjs"), true);
  const cleanedGeminiSettings = readJson(path.join(home, ".gemini", "settings.json"));
  assert.equal(JSON.stringify(cleanedGeminiSettings).includes("clisponsor_gemini_hook.mjs"), false);
  assert.equal(JSON.stringify(cleanedGeminiSettings).includes("keep-gemini.mjs"), true);
  const cleanedAntigravityHooks = readJson(path.join(home, ".gemini", "config", "hooks.json"));
  assert.equal(JSON.stringify(cleanedAntigravityHooks).includes("clisponsor_antigravity_hook.mjs"), false);
  assert.equal(JSON.stringify(cleanedAntigravityHooks).includes("keep-antigravity.mjs"), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-plugin")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-marketplace")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "clisponsor_claude_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "gemini", "clisponsor_gemini_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "antigravity", "clisponsor_antigravity_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "config.json")), false);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
