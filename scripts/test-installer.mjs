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
    env: {
      ...process.env,
      HOME: testHome,
      XDG_CONFIG_HOME: path.join(testHome, ".config"),
      XDG_DATA_HOME: path.join(testHome, ".local", "share"),
      XDG_CACHE_HOME: path.join(testHome, ".cache"),
      PATH: pathValue,
      ...env,
    },
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
  const { expectedStatus = 0, input = "", env = {}, testHome = home } = options;
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      HOME: testHome,
      XDG_CONFIG_HOME: path.join(testHome, ".config"),
      XDG_DATA_HOME: path.join(testHome, ".local", "share"),
      XDG_CACHE_HOME: path.join(testHome, ".cache"),
      ...env,
    },
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
  assert.match(help, /opencode/);
  assert.match(help, /pi/);
  assert.match(help, /copilot/);
  assert.match(help, /qwen/);
  assert.match(help, /droid/);
  assert.match(help, /devin/);

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
  assert.match(installOutput, /CLIsponsor installer/);
  assert.match(installOutput, /Codex CLI .*not found/);
  assert.match(installOutput, /Claude Code CLI .*installed/);
  assert.match(installOutput, /Gemini CLI .*not found/);
  assert.match(installOutput, /Antigravity CLI .*not found/);
  assert.match(installOutput, /OpenCode CLI .*not found/);
  assert.match(installOutput, /Pi Coding Agent .*not found/);
  assert.match(installOutput, /GitHub Copilot CLI .*not found/);
  assert.match(installOutput, /Qwen Code .*not found/);
  assert.match(installOutput, /Factory Droid CLI .*not found/);
  assert.match(installOutput, /Devin CLI .*not found/);
  assert.doesNotMatch(installOutput, /Codex CLI plugin installed/);
  assert.doesNotMatch(installOutput, /Claude Code CLI hook installed/);
  assert.doesNotMatch(installOutput, /Gemini CLI hook installed/);
  assert.doesNotMatch(installOutput, /Antigravity CLI hook installed/);
  assert.doesNotMatch(installOutput, /OpenCode CLI plugin installed/);
  assert.doesNotMatch(installOutput, /Pi CLI extension installed/);
  assert.doesNotMatch(installOutput, /GitHub Copilot CLI hook installed/);
  assert.doesNotMatch(installOutput, /Qwen Code CLI hook installed/);
  assert.doesNotMatch(installOutput, /Factory Droid CLI hook installed/);
  assert.doesNotMatch(installOutput, /Devin CLI hook installed/);
  assert.equal(fs.existsSync(path.join(home, ".gemini", "settings.json")), false);
  assert.equal(fs.existsSync(path.join(home, ".gemini", "config", "hooks.json")), false);
  assert.equal(fs.existsSync(path.join(home, ".pi", "agent", "extensions", "clisponsor_pi_extension.ts")), false);
  assert.equal(fs.existsSync(path.join(home, ".copilot", "hooks", "clisponsor.json")), false);
  assert.equal(fs.existsSync(path.join(home, ".qwen", "settings.json")), false);
  assert.equal(fs.existsSync(path.join(home, ".factory", "hooks.json")), false);
  assert.equal(fs.existsSync(path.join(home, ".config", "devin", "config.json")), false);
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
  assert.equal(doctor.installed.qwenHookScript, false);
  assert.equal(doctor.installed.droidHookScript, false);
  assert.equal(doctor.installed.devinHookScript, false);

  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-plugin", "scripts", "clisponsor_codex_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-marketplace", "plugins", "clisponsor")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "clisponsor_claude_hook.mjs")), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "gemini", "clisponsor_gemini_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "antigravity", "clisponsor_antigravity_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".config", "opencode", "plugins", "clisponsor_opencode_plugin.js")), false);
  assert.equal(fs.existsSync(path.join(home, ".pi", "agent", "extensions", "clisponsor_pi_extension.ts")), false);
  assert.equal(fs.existsSync(path.join(home, ".copilot", "hooks", "clisponsor.json")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "qwen", "clisponsor_qwen_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "droid", "clisponsor_droid_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "devin", "clisponsor_devin_hook.mjs")), false);

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
  assert.match(codexInstallOutput, /Codex CLI .*installed/);
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
  assert.match(geminiInstallOutput, /Gemini CLI .*installed/);
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
    Done: {
      PostInvocation: [{ type: "command", command: "node /tmp/keep-antigravity.mjs", timeout: 30 }],
    },
    hooks: {
      UserPromptSubmit: [
        {
          matcher: "*",
          hooks: [
            {
              name: "clisponsor",
              type: "command",
              command: "node /tmp/.clisponsor/antigravity/clisponsor_antigravity_hook.mjs UserPromptSubmit",
              timeout: 5000,
            },
          ],
        },
      ],
    },
  });
  const fakeBinWithAntigravity = makeFakeBin(["agy"]);
  const antigravityInstallOutput = run(["install", "antigravity"], { pathValue: fakeBinWithAntigravity });
  assert.match(antigravityInstallOutput, /Antigravity CLI .*installed/);
  const antigravityHook = path.join(home, ".clisponsor", "antigravity", "clisponsor_antigravity_hook.mjs");
  const antigravityHookRun = runNode(["--import", hookMock, antigravityHook, "PreInvocation"], {
    input: JSON.stringify({ prompt: "do not capture this for antigravity", invocationNum: 1, initialNumSteps: 1 }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  assert.deepEqual(JSON.parse(antigravityHookRun.stdout), {
    injectSteps: [{ userMessage: "[Sponsored] Test sponsor line" }],
  });
  const capturedAntigravityHook = readJson(hookCapture);
  const capturedAntigravityBody = JSON.parse(capturedAntigravityHook.body);
  assert.equal(capturedAntigravityHook.url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(capturedAntigravityHook.headers.authorization, "Bearer cls_dev_test-secret");
  assert.equal(capturedAntigravityBody.client, "Antigravity");
  assert.equal(capturedAntigravityBody.hook_event, "PreInvocation");
  assert.equal(capturedAntigravityBody.placement, "StartTurn");
  assert.equal(capturedAntigravityBody.metadata.antigravity.invocationNum, 1);
  assert.equal(JSON.stringify(capturedAntigravityBody).includes("do not capture this for antigravity"), false);
  fs.rmSync(hookCapture, { force: true });
  const antigravityInternalInvocationRun = runNode(["--import", hookMock, antigravityHook, "PreInvocation"], {
    input: JSON.stringify({ prompt: "do not capture this for antigravity internal invocation", invocationNum: 2 }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  assert.deepEqual(JSON.parse(antigravityInternalInvocationRun.stdout), {});
  assert.equal(fs.existsSync(hookCapture), false);
  const brokenAntigravityConfig = readJson(path.join(home, ".clisponsor", "config.json"));
  writeJson(path.join(home, ".clisponsor", "config.json"), { ...brokenAntigravityConfig, deviceSecret: "" });
  const antigravityNoLoginRun = runNode([antigravityHook, "PreInvocation"], {
    input: JSON.stringify({ invocationNum: 1 }),
  });
  assert.deepEqual(JSON.parse(antigravityNoLoginRun.stdout), {});
  writeJson(path.join(home, ".clisponsor", "config.json"), brokenAntigravityConfig);
  const antigravityHooks = readJson(path.join(home, ".gemini", "config", "hooks.json"));
  assert.equal(JSON.stringify(antigravityHooks).includes("keep-antigravity.mjs"), true);
  assert.equal(JSON.stringify(antigravityHooks.hooks || {}).includes("clisponsor_antigravity_hook.mjs"), false);
  assert.equal(
    antigravityHooks.clisponsor.PreInvocation.filter((entry) => JSON.stringify(entry).includes("clisponsor_antigravity_hook.mjs")).length,
    1,
  );
  assert.equal(Object.hasOwn(antigravityHooks.clisponsor, "UserPromptSubmit"), false);
  assert.equal(Object.hasOwn(antigravityHooks.clisponsor, "PostInvocation"), false);
  assert.equal(Object.hasOwn(antigravityHooks.clisponsor, "Stop"), false);
  assert.equal(antigravityHooks.clisponsor.PreInvocation[0].timeout, 5);
  run(["install", "agy"], { pathValue: fakeBinWithAntigravity });
  const antigravityHooksAfterReinstall = readJson(path.join(home, ".gemini", "config", "hooks.json"));
  assert.equal(
    antigravityHooksAfterReinstall.clisponsor.PreInvocation.filter((entry) => JSON.stringify(entry).includes("clisponsor_antigravity_hook.mjs")).length,
    1,
  );

  const fakeBinWithOpenCode = makeFakeBin(["opencode"]);
  const opencodeInstallOutput = run(["install", "opencode"], { pathValue: fakeBinWithOpenCode });
  assert.match(opencodeInstallOutput, /OpenCode CLI .*installed/);
  const opencodePlugin = path.join(home, ".config", "opencode", "plugins", "clisponsor_opencode_plugin.js");
  assert.equal(fs.existsSync(opencodePlugin), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "opencode", "clisponsor_opencode_plugin.js")), true);

  const opencodeProbe = path.join(home, "probe-opencode-plugin.mjs");
  fs.writeFileSync(
    opencodeProbe,
    `
import fs from "node:fs";
const mod = await import(${JSON.stringify(`file://${opencodePlugin}`)});
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, ...options });
  return { ok: true, async json() { return { display_line: "OpenCode sponsor line" }; } };
};
const toasts = [];
const hooks = await mod.CLIsponsorOpenCodePlugin({
  client: {
    tui: {
      async showToast(input) {
        toasts.push(input);
        return { data: true };
      },
    },
  },
});
await hooks["chat.message"]({ sessionID: "session-123", agent: "build" }, {});
fs.writeFileSync(process.env.CLISPONSOR_OPENCODE_PROBE_PATH, JSON.stringify({ calls, toasts }, null, 2));
`,
  );
  const opencodeProbeOutput = path.join(home, "opencode-probe-output.json");
  runNode([opencodeProbe, "opencode"], {
    env: { CLISPONSOR_OPENCODE_PROBE_PATH: opencodeProbeOutput },
  });
  const opencodeProbeResult = readJson(opencodeProbeOutput);
  assert.equal(opencodeProbeResult.calls.length, 1);
  assert.equal(opencodeProbeResult.calls[0].url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(opencodeProbeResult.calls[0].headers.authorization, "Bearer cls_dev_test-secret");
  const opencodeBody = JSON.parse(opencodeProbeResult.calls[0].body);
  assert.equal(opencodeBody.client, "OpenCode");
  assert.equal(opencodeBody.hook_event, "chat.message");
  assert.equal(opencodeBody.placement, "StartTurn");
  assert.equal(opencodeBody.metadata.openCode.sessionID, "session-123");
  assert.equal(opencodeProbeResult.toasts.length, 1);
  assert.equal(opencodeProbeResult.toasts[0].body.title, "CLIsponsor Message");
  assert.equal(opencodeProbeResult.toasts[0].body.message, "[Sponsored] OpenCode sponsor line");

  const fakeBinWithPi = makeFakeBin(["pi"]);
  const piInstallOutput = run(["install", "pi"], { pathValue: fakeBinWithPi });
  assert.match(piInstallOutput, /Pi Coding Agent .*installed/);
  const piExtension = path.join(home, ".pi", "agent", "extensions", "clisponsor_pi_extension.ts");
  assert.equal(fs.existsSync(piExtension), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "pi", "clisponsor_pi_extension.ts")), true);

  const piProbe = path.join(home, "probe-pi-extension.mjs");
  const piProbeImport = path.join(home, "clisponsor_pi_extension_probe.mjs");
  fs.copyFileSync(piExtension, piProbeImport);
  fs.writeFileSync(
    piProbe,
    `
import fs from "node:fs";
const mod = await import(${JSON.stringify(`file://${piProbeImport}`)});
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, ...options });
  return { ok: true, async json() { return { display_line: "Pi sponsor line" }; } };
};
const notifications = [];
const handlers = new Map();
mod.default({
  on(event, handler) {
    handlers.set(event, handler);
  },
});
const ctx = {
  hasUI: true,
  ui: {
    notify(message, variant) {
      notifications.push({ message, variant });
    },
  },
};
await handlers.get("agent_start")({}, ctx);
fs.writeFileSync(process.env.CLISPONSOR_PI_PROBE_PATH, JSON.stringify({ calls, notifications }, null, 2));
`,
  );
  const piProbeOutput = path.join(home, "pi-probe-output.json");
  runNode([piProbe], {
    env: { CLISPONSOR_PI_PROBE_PATH: piProbeOutput },
  });
  const piProbeResult = readJson(piProbeOutput);
  assert.equal(piProbeResult.calls.length, 1);
  assert.equal(piProbeResult.calls[0].url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(piProbeResult.calls[0].headers.authorization, "Bearer cls_dev_test-secret");
  const piBody = JSON.parse(piProbeResult.calls[0].body);
  assert.equal(piBody.client, "Pi");
  assert.equal(piBody.hook_event, "agent_start");
  assert.equal(piBody.placement, "StartTurn");
  assert.deepEqual(piBody.metadata.pi, {});
  assert.equal(piProbeResult.notifications.length, 1);
  assert.equal(piProbeResult.notifications[0].variant, "info");
  assert.equal(piProbeResult.notifications[0].message, "CLIsponsor Message\n[Sponsored] Pi sponsor line");

  const fakeBinWithCopilot = makeFakeBin(["copilot"]);
  const copilotInstallOutput = run(["install", "copilot"], { pathValue: fakeBinWithCopilot });
  assert.match(copilotInstallOutput, /GitHub Copilot CLI .*installed/);
  const copilotHooksPath = path.join(home, ".copilot", "hooks", "clisponsor.json");
  const copilotHook = path.join(home, ".clisponsor", "copilot", "clisponsor_copilot_hook.mjs");
  assert.equal(fs.existsSync(copilotHooksPath), true);
  assert.equal(fs.existsSync(copilotHook), true);
  const copilotHooks = readJson(copilotHooksPath);
  assert.equal(copilotHooks.version, 1);
  assert.equal(copilotHooks.hooks.sessionStart.length, 1);
  assert.equal(copilotHooks.hooks.userPromptSubmitted.length, 1);
  assert.equal(copilotHooks.hooks.agentStop.length, 1);
  assert.equal(JSON.stringify(copilotHooks).includes("clisponsor_copilot_hook.mjs"), true);

  const copilotHookRun = runNode(["--import", hookMock, copilotHook, "userPromptSubmitted"], {
    input: JSON.stringify({
      sessionId: "copilot-session-123",
      prompt: "do not capture this for copilot",
      cwd: "/private/project/path",
    }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  const copilotOutput = copilotHookRun.stdout.trim().split(/\n/).map((line) => JSON.parse(line));
  assert.deepEqual(copilotOutput, [
    { type: "progress", message: "CLIsponsor Message: [Sponsored] Test sponsor line" },
    {},
  ]);
  const capturedCopilotHook = readJson(hookCapture);
  const capturedCopilotBody = JSON.parse(capturedCopilotHook.body);
  assert.equal(capturedCopilotHook.url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(capturedCopilotHook.headers.authorization, "Bearer cls_dev_test-secret");
  assert.equal(capturedCopilotBody.client, "GitHubCopilot");
  assert.equal(capturedCopilotBody.hook_event, "userPromptSubmitted");
  assert.equal(capturedCopilotBody.placement, "StartTurn");
  assert.equal(capturedCopilotBody.metadata.copilot.sessionId, "copilot-session-123");
  assert.equal(JSON.stringify(capturedCopilotBody).includes("do not capture this for copilot"), false);
  assert.equal(JSON.stringify(capturedCopilotBody).includes("/private/project/path"), false);

  fs.mkdirSync(path.join(home, ".qwen"), { recursive: true });
  writeJson(path.join(home, ".qwen", "settings.json"), {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: "node /tmp/keep-qwen.mjs", timeout: 1 }],
        },
      ],
    },
  });
  const fakeBinWithQwen = makeFakeBin(["qwen"]);
  const qwenInstallOutput = run(["install", "qwen"], { pathValue: fakeBinWithQwen });
  assert.match(qwenInstallOutput, /Qwen Code .*installed/);
  const qwenHook = path.join(home, ".clisponsor", "qwen", "clisponsor_qwen_hook.mjs");
  assert.equal(fs.existsSync(qwenHook), true);
  const qwenSettings = readJson(path.join(home, ".qwen", "settings.json"));
  assert.equal(JSON.stringify(qwenSettings).includes("keep-qwen.mjs"), true);
  assert.equal(
    qwenSettings.hooks.SessionStart.filter((entry) => JSON.stringify(entry).includes("clisponsor_qwen_hook.mjs")).length,
    1,
  );
  assert.equal(
    qwenSettings.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_qwen_hook.mjs")).length,
    1,
  );
  assert.equal(
    qwenSettings.hooks.Stop.filter((entry) => JSON.stringify(entry).includes("clisponsor_qwen_hook.mjs")).length,
    1,
  );
  assert.equal(qwenSettings.hooks.UserPromptSubmit[1].hooks[0].name, "clisponsor");
  assert.equal(qwenSettings.hooks.UserPromptSubmit[1].hooks[0].timeout, 5000);
  const qwenTtyCapture = path.join(home, "qwen-terminal-message.txt");
  const qwenHookRun = runNode(["--import", hookMock, qwenHook, "UserPromptSubmit"], {
    input: JSON.stringify({
      prompt: "do not capture this for qwen",
      last_assistant_message: "do not capture assistant text for qwen",
      cwd: "/private/qwen/project",
    }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture, CLISPONSOR_TTY_MESSAGE_PATH: qwenTtyCapture },
  });
  assert.deepEqual(JSON.parse(qwenHookRun.stdout), {});
  assert.equal(fs.readFileSync(qwenTtyCapture, "utf8"), "\nCLIsponsor Message: [Sponsored] Test sponsor line\n");
  const capturedQwenHook = readJson(hookCapture);
  const capturedQwenBody = JSON.parse(capturedQwenHook.body);
  assert.equal(capturedQwenHook.url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(capturedQwenHook.headers.authorization, "Bearer cls_dev_test-secret");
  assert.equal(capturedQwenBody.client, "QwenCode");
  assert.equal(capturedQwenBody.hook_event, "UserPromptSubmit");
  assert.equal(capturedQwenBody.placement, "StartTurn");
  assert.equal(capturedQwenBody.metadata.hookInput, undefined);
  assert.equal(JSON.stringify(capturedQwenBody).includes("do not capture this for qwen"), false);
  assert.equal(JSON.stringify(capturedQwenBody).includes("do not capture assistant text for qwen"), false);
  assert.equal(JSON.stringify(capturedQwenBody).includes("/private/qwen/project"), false);
  run(["install", "qwen"], { pathValue: fakeBinWithQwen });
  const qwenSettingsAfterReinstall = readJson(path.join(home, ".qwen", "settings.json"));
  assert.equal(
    qwenSettingsAfterReinstall.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_qwen_hook.mjs")).length,
    1,
  );

  fs.mkdirSync(path.join(home, ".factory"), { recursive: true });
  writeJson(path.join(home, ".factory", "hooks.json"), {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: "node /tmp/keep-droid.mjs", timeout: 1 }],
        },
      ],
    },
  });
  const fakeBinWithDroid = makeFakeBin(["droid"]);
  const droidInstallOutput = run(["install", "droid"], { pathValue: fakeBinWithDroid });
  assert.match(droidInstallOutput, /Factory Droid CLI .*installed/);
  const droidHook = path.join(home, ".clisponsor", "droid", "clisponsor_droid_hook.mjs");
  assert.equal(fs.existsSync(droidHook), true);
  const droidHooks = readJson(path.join(home, ".factory", "hooks.json"));
  assert.equal(JSON.stringify(droidHooks).includes("keep-droid.mjs"), true);
  assert.equal(
    droidHooks.hooks.SessionStart.filter((entry) => JSON.stringify(entry).includes("clisponsor_droid_hook.mjs")).length,
    1,
  );
  assert.equal(
    droidHooks.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_droid_hook.mjs")).length,
    1,
  );
  assert.equal(
    droidHooks.hooks.Stop.filter((entry) => JSON.stringify(entry).includes("clisponsor_droid_hook.mjs")).length,
    1,
  );
  assert.equal(droidHooks.hooks.UserPromptSubmit[1].hooks[0].name, "clisponsor");
  assert.equal(droidHooks.hooks.UserPromptSubmit[1].hooks[0].timeout, 5);
  const droidHookRun = runNode(["--import", hookMock, droidHook, "UserPromptSubmit"], {
    input: JSON.stringify({
      prompt: "do not capture this for droid",
      cwd: "/private/droid/project",
      transcript_path: "/private/droid/transcript.jsonl",
    }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  assert.deepEqual(JSON.parse(droidHookRun.stdout), { systemMessage: "[Sponsored] Test sponsor line" });
  const capturedDroidHook = readJson(hookCapture);
  const capturedDroidBody = JSON.parse(capturedDroidHook.body);
  assert.equal(capturedDroidHook.url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(capturedDroidHook.headers.authorization, "Bearer cls_dev_test-secret");
  assert.equal(capturedDroidBody.client, "Droid");
  assert.equal(capturedDroidBody.hook_event, "UserPromptSubmit");
  assert.equal(capturedDroidBody.placement, "StartTurn");
  assert.equal(capturedDroidBody.metadata.hookInput, undefined);
  assert.equal(JSON.stringify(capturedDroidBody).includes("do not capture this for droid"), false);
  assert.equal(JSON.stringify(capturedDroidBody).includes("/private/droid/project"), false);
  assert.equal(JSON.stringify(capturedDroidBody).includes("transcript.jsonl"), false);
  run(["install", "droid"], { pathValue: fakeBinWithDroid });
  const droidHooksAfterReinstall = readJson(path.join(home, ".factory", "hooks.json"));
  assert.equal(
    droidHooksAfterReinstall.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_droid_hook.mjs")).length,
    1,
  );

  fs.mkdirSync(path.join(home, ".config", "devin"), { recursive: true });
  writeJson(path.join(home, ".config", "devin", "config.json"), {
    theme: "dark",
    hooks: {
      UserPromptSubmit: [
        {
          matcher: "",
          hooks: [{ type: "command", command: "node /tmp/keep-devin.mjs", timeout: 1 }],
        },
      ],
    },
  });
  const fakeBinWithDevin = makeFakeBin(["devin"]);
  const devinInstallOutput = run(["install", "devin"], { pathValue: fakeBinWithDevin });
  assert.match(devinInstallOutput, /Devin CLI .*installed/);
  const devinHook = path.join(home, ".clisponsor", "devin", "clisponsor_devin_hook.mjs");
  assert.equal(fs.existsSync(devinHook), true);
  const devinSettings = readJson(path.join(home, ".config", "devin", "config.json"));
  assert.equal(devinSettings.theme, "dark");
  assert.equal(JSON.stringify(devinSettings).includes("keep-devin.mjs"), true);
  assert.equal(
    devinSettings.hooks.SessionStart.filter((entry) => JSON.stringify(entry).includes("clisponsor_devin_hook.mjs")).length,
    1,
  );
  assert.equal(
    devinSettings.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_devin_hook.mjs")).length,
    1,
  );
  assert.equal(
    devinSettings.hooks.Stop.filter((entry) => JSON.stringify(entry).includes("clisponsor_devin_hook.mjs")).length,
    1,
  );
  assert.equal(devinSettings.hooks.UserPromptSubmit[1].matcher, "");
  assert.equal(devinSettings.hooks.UserPromptSubmit[1].hooks[0].name, "clisponsor");
  assert.equal(devinSettings.hooks.UserPromptSubmit[1].hooks[0].timeout, 5);
  const devinHookRun = runNode(["--import", hookMock, devinHook, "UserPromptSubmit"], {
    input: JSON.stringify({
      prompt: "do not capture this for devin",
      cwd: "/private/devin/project",
      transcript_path: "/private/devin/transcript.jsonl",
    }),
    env: { CLISPONSOR_HOOK_CAPTURE_PATH: hookCapture },
  });
  assert.deepEqual(JSON.parse(devinHookRun.stdout), { systemMessage: "[Sponsored] Test sponsor line" });
  const capturedDevinHook = readJson(hookCapture);
  const capturedDevinBody = JSON.parse(capturedDevinHook.body);
  assert.equal(capturedDevinHook.url, "https://serve.clisponsor.com/v1/ads/serve");
  assert.equal(capturedDevinHook.headers.authorization, "Bearer cls_dev_test-secret");
  assert.equal(capturedDevinBody.client, "Devin");
  assert.equal(capturedDevinBody.hook_event, "UserPromptSubmit");
  assert.equal(capturedDevinBody.placement, "StartTurn");
  assert.equal(capturedDevinBody.metadata.hookInput, undefined);
  assert.equal(JSON.stringify(capturedDevinBody).includes("do not capture this for devin"), false);
  assert.equal(JSON.stringify(capturedDevinBody).includes("/private/devin/project"), false);
  assert.equal(JSON.stringify(capturedDevinBody).includes("transcript.jsonl"), false);
  run(["install", "devin"], { pathValue: fakeBinWithDevin });
  const devinSettingsAfterReinstall = readJson(path.join(home, ".config", "devin", "config.json"));
  assert.equal(
    devinSettingsAfterReinstall.hooks.UserPromptSubmit.filter((entry) => JSON.stringify(entry).includes("clisponsor_devin_hook.mjs")).length,
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
  const cleanedQwenSettings = readJson(path.join(home, ".qwen", "settings.json"));
  assert.equal(JSON.stringify(cleanedQwenSettings).includes("clisponsor_qwen_hook.mjs"), false);
  assert.equal(JSON.stringify(cleanedQwenSettings).includes("keep-qwen.mjs"), true);
  const cleanedDroidHooks = readJson(path.join(home, ".factory", "hooks.json"));
  assert.equal(JSON.stringify(cleanedDroidHooks).includes("clisponsor_droid_hook.mjs"), false);
  assert.equal(JSON.stringify(cleanedDroidHooks).includes("keep-droid.mjs"), true);
  const cleanedDevinSettings = readJson(path.join(home, ".config", "devin", "config.json"));
  assert.equal(JSON.stringify(cleanedDevinSettings).includes("clisponsor_devin_hook.mjs"), false);
  assert.equal(JSON.stringify(cleanedDevinSettings).includes("keep-devin.mjs"), true);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-plugin")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "codex-marketplace")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "claude", "clisponsor_claude_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "gemini", "clisponsor_gemini_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "antigravity", "clisponsor_antigravity_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".config", "opencode", "plugins", "clisponsor_opencode_plugin.js")), false);
  assert.equal(fs.existsSync(path.join(home, ".pi", "agent", "extensions", "clisponsor_pi_extension.ts")), false);
  assert.equal(fs.existsSync(path.join(home, ".copilot", "hooks", "clisponsor.json")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "qwen", "clisponsor_qwen_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "droid", "clisponsor_droid_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "devin", "clisponsor_devin_hook.mjs")), false);
  assert.equal(fs.existsSync(path.join(home, ".clisponsor", "config.json")), false);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
