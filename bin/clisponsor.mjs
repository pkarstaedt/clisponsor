#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CONFIG_DIR = path.join(HOME, ".clisponsor");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DEFAULT_SERVE_BASE_URL =
  process.env.CLISPONSOR_SERVE_BASE_URL ||
  process.env.CLISPONSOR_API_BASE_URL ||
  "https://serve.clisponsor.com";
const DEFAULT_BACKEND_BASE_URL = process.env.CLISPONSOR_BACKEND_BASE_URL || "https://backend.clisponsor.com";
const HOOK_VERSION = "1.0.0";
const NETWORK_TIMEOUT_MS = 3000;

function argValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function positionalArg(index) {
  const value = process.argv[index];
  return value && !value.startsWith("--") ? value : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function hostnameFor(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function looksLikeBackendBaseUrl(value) {
  const hostname = hostnameFor(value);
  return hostname === "backend.clisponsor.com" || hostname.startsWith("backend.");
}

function looksLikeServeBaseUrl(value) {
  const hostname = hostnameFor(value);
  return hostname === "serve.clisponsor.com" || hostname.startsWith("serve.");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readEditableJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Cannot parse ${file}: ${err.message}`);
    console.error("Fix the JSON before running this command so existing settings are not overwritten.");
    process.exit(1);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function config() {
  const raw = readJson(CONFIG_PATH, {});
  const legacyApiBaseUrl = normalizeBaseUrl(raw.apiBaseUrl);
  const serveBaseUrl = normalizeBaseUrl(
    raw.serveBaseUrl ||
      (legacyApiBaseUrl && !looksLikeBackendBaseUrl(legacyApiBaseUrl) ? legacyApiBaseUrl : "") ||
      DEFAULT_SERVE_BASE_URL,
  );
  const backendBaseUrl = normalizeBaseUrl(
    raw.backendBaseUrl ||
      (legacyApiBaseUrl && !looksLikeServeBaseUrl(legacyApiBaseUrl) ? legacyApiBaseUrl : "") ||
      DEFAULT_BACKEND_BASE_URL,
  );
  return {
    ...raw,
    serveBaseUrl,
    backendBaseUrl,
    apiBaseUrl: serveBaseUrl,
    email: raw.email || "",
    userId: raw.userId || raw.user_id || "",
    deviceCode: raw.deviceCode || raw.device_code || "",
    deviceSecret: raw.deviceSecret || raw.device_secret || "",
    deviceLabel: raw.deviceLabel || raw.device_label || raw.label || "",
  };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function patchFile(file, replacements) {
  let text = fs.readFileSync(file, "utf8");
  for (const [from, to] of Object.entries(replacements)) text = text.replaceAll(from, to);
  fs.writeFileSync(file, text);
}

function chmodExecutable(file) {
  try {
    fs.chmodSync(file, 0o755);
  } catch {}
}

function commandExists(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isClisponsorCommand(value) {
  return (
    typeof value === "string" &&
    (value.includes("clisponsor_claude_hook.mjs") ||
      value.includes("clisponsor_gemini_hook.mjs") ||
      value.includes(`${path.sep}.clisponsor${path.sep}`) ||
      value.includes("/.clisponsor/") ||
      value.includes("\\.clisponsor\\"))
  );
}

function isClisponsorHookEntry(entry) {
  if (!isPlainObject(entry)) return false;
  if (isClisponsorCommand(entry.command)) return true;
  return Array.isArray(entry.hooks) && entry.hooks.some((hook) => isClisponsorHookEntry(hook));
}

function removeClisponsorHooksFromEntry(entry) {
  if (!isPlainObject(entry)) return { entry, removed: false, empty: false };
  if (isClisponsorCommand(entry.command)) return { removed: true, empty: true };
  if (!Array.isArray(entry.hooks)) return { entry, removed: false, empty: false };

  let removed = false;
  const nextHooks = [];
  for (const hook of entry.hooks) {
    const result = removeClisponsorHooksFromEntry(hook);
    removed ||= result.removed;
    if (!result.empty) nextHooks.push(result.entry);
  }
  const nextEntry = { ...entry, hooks: nextHooks };
  return { entry: nextEntry, removed, empty: nextHooks.length === 0 };
}

function addClaudeCommandHook(settings, eventName, command) {
  if (!isPlainObject(settings.hooks)) settings.hooks = {};
  const current = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : [];
  const exists = current.some((entry) => isClisponsorHookEntry(entry));
  if (exists) return false;

  settings.hooks[eventName] = [
    ...current,
    {
      hooks: [
        {
          type: "command",
          command,
          timeout: 5,
          statusMessage: "Loading sponsor",
        },
      ],
    },
  ];
  return true;
}

function removeClaudeCommandHooks(settings) {
  if (!isPlainObject(settings.hooks)) return false;
  let changed = false;

  for (const [eventName, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    const nextEntries = [];
    let eventChanged = false;
    for (const entry of entries) {
      const result = removeClisponsorHooksFromEntry(entry);
      eventChanged ||= result.removed;
      if (!result.empty) nextEntries.push(result.entry);
    }
    if (eventChanged) {
      if (nextEntries.length > 0) settings.hooks[eventName] = nextEntries;
      else delete settings.hooks[eventName];
      changed = true;
    }
  }

  if (isPlainObject(settings.statusLine) && isClisponsorCommand(settings.statusLine.command)) {
    delete settings.statusLine;
    changed = true;
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return changed;
}

async function registerDevice() {
  const email = positionalArg(3);
  if (!email) {
    console.error("Missing email. Run: clisponsor login <email>");
    process.exit(1);
  }
  const next = config();
  const serveApiArg = argValue("--serve-api");
  const backendApiArg = argValue("--backend-api");
  const labelArg = argValue("--label");

  if (serveApiArg) next.serveBaseUrl = normalizeBaseUrl(serveApiArg);
  if (backendApiArg) next.backendBaseUrl = normalizeBaseUrl(backendApiArg);
  next.apiBaseUrl = next.serveBaseUrl;

  const response = await fetch(`${next.backendBaseUrl}/v1/cli/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      label: labelArg || next.deviceLabel || undefined,
      serve_base_url: next.serveBaseUrl,
    }),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok) {
    const detail = payload.detail || payload.error || `HTTP ${response.status}`;
    console.error(`CLIsponsor login failed: ${detail}`);
    process.exit(1);
  }

  next.email = payload.email || email;
  next.userId = payload.user_id || payload.userId;
  next.deviceCode = payload.device_code || payload.deviceCode;
  next.deviceSecret = payload.device_secret || payload.deviceSecret || "";
  next.deviceLabel = payload.label || labelArg || next.deviceLabel || "";
  if (!next.userId || !next.deviceCode || !next.deviceSecret) {
    console.error("CLIsponsor login failed: backend response did not include user_id, device_code, and device_secret.");
    process.exit(1);
  }
  writeJson(CONFIG_PATH, next);
  console.log(`Logged in ${next.email}`);
  console.log(`Device code: ${next.deviceCode}`);
  return next;
}

async function login() {
  await registerDevice();
}

function installCodex() {
  const pluginRoot = path.join(CONFIG_DIR, "codex-plugin");
  copyDir(path.join(ROOT, "templates", "codex-plugin"), pluginRoot);
  patchFile(path.join(pluginRoot, "hooks", "hooks.json"), {
    "__CLISPONSOR_HOOK_SCRIPT__": path.join(pluginRoot, "scripts", "clisponsor_codex_hook.mjs"),
  });
  patchFile(path.join(pluginRoot, "scripts", "clisponsor_codex_hook.mjs"), {
    "__CLISPONSOR_CONFIG_PATH__": CONFIG_PATH,
  });
  chmodExecutable(path.join(pluginRoot, "scripts", "clisponsor_codex_hook.mjs"));

  const marketplaceRoot = path.join(CONFIG_DIR, "codex-marketplace");
  const marketplacePath = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");
  fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
  fs.mkdirSync(path.join(marketplaceRoot, "plugins"), { recursive: true });
  const linkedPlugin = path.join(marketplaceRoot, "plugins", "clisponsor");
  fs.rmSync(linkedPlugin, { recursive: true, force: true });
  copyDir(pluginRoot, linkedPlugin);
  writeJson(marketplacePath, {
    name: "clisponsor-local",
    interface: { displayName: "CLIsponsor Local" },
    plugins: [
      {
        name: "clisponsor",
        source: { source: "local", path: "./plugins/clisponsor" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  });
  try {
    execFileSync("codex", ["plugin", "marketplace", "add", marketplaceRoot], { stdio: "ignore" });
  } catch {}
  try {
    execFileSync("codex", ["plugin", "add", "clisponsor@clisponsor-local"], { stdio: "ignore" });
    console.log("Codex CLI plugin installed.");
  } catch {
    console.log("Codex CLI plugin staged. After installing Codex CLI, rerun: npx clisponsor install");
  }
}

function installClaude() {
  const claudeDir = path.join(CONFIG_DIR, "claude");
  const installedHook = path.join(claudeDir, "clisponsor_claude_hook.mjs");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "templates", "claude", "clisponsor_claude_hook.mjs"), installedHook);
  chmodExecutable(installedHook);

  if (!commandExists("claude")) {
    console.log("Claude Code CLI hook staged. After installing Claude Code CLI, rerun: npx clisponsor install");
    return;
  }

  const settingsPath = path.join(HOME, ".claude", "settings.json");
  const settings = readEditableJson(settingsPath, {});
  addClaudeCommandHook(settings, "SessionStart", `node ${JSON.stringify(installedHook)} SessionStart`);
  addClaudeCommandHook(settings, "UserPromptSubmit", `node ${JSON.stringify(installedHook)} UserPromptSubmit`);
  addClaudeCommandHook(settings, "Stop", `node ${JSON.stringify(installedHook)} Stop`);
  writeJson(settingsPath, settings);
  console.log(`Updated ${settingsPath}`);
  console.log("Claude Code CLI hook installed.");
}

function geminiHookSource() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(CONFIG_PATH)}, "utf8"));
const event = process.argv[2] || "StartTurn";
const placements = { SessionStart: "StartSession", UserPromptSubmit: "StartTurn", Stop: "EndTurn", StartTurn: "StartTurn" };
const serveBaseUrl = cfg.serveBaseUrl || cfg.apiBaseUrl;
try {
  if (!serveBaseUrl || !cfg.userId || !cfg.deviceCode || !cfg.deviceSecret) process.exit(0);
  const placement = placements[event] || event;
  const body = { user_id: cfg.userId, device_code: cfg.deviceCode, client: "Gemini", hook_event: event, placement, idempotency_key: crypto.randomUUID(), metadata: { hookVersion: ${JSON.stringify(HOOK_VERSION)} } };
  const res = await fetch(serveBaseUrl + "/v1/ads/serve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + cfg.deviceSecret,
      "x-clisponsor-hook-version": ${JSON.stringify(HOOK_VERSION)}
    },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    const ad = await res.json();
    if (ad.display_line) console.log(ad.display_line);
  }
} catch {}
`;
}

function installGemini() {
  const geminiDir = path.join(CONFIG_DIR, "gemini");
  fs.mkdirSync(geminiDir, { recursive: true });
  const hookPath = path.join(geminiDir, "clisponsor_gemini_hook.mjs");
  fs.writeFileSync(hookPath, geminiHookSource(), { mode: 0o755 });
  if (commandExists("gemini")) {
    console.log("Gemini CLI hook script staged.");
    console.log("Gemini CLI does not expose a CLIsponsor auto-configuration target yet; configure it to run:");
    console.log(`node ${JSON.stringify(hookPath)} StartTurn`);
  } else {
    console.log("Gemini CLI hook script staged. After installing Gemini CLI, rerun: npx clisponsor install");
  }
}

function installAll() {
  installCodex();
  installClaude();
  installGemini();
}

function uninstallCodex() {
  fs.rmSync(path.join(CONFIG_DIR, "codex-plugin"), { recursive: true, force: true });
  fs.rmSync(path.join(CONFIG_DIR, "codex-marketplace"), { recursive: true, force: true });
  console.log("Removed staged Codex plugin files.");
}

function uninstallClaude() {
  const settingsPath = path.join(HOME, ".claude", "settings.json");
  const settings = readEditableJson(settingsPath, {});
  if (removeClaudeCommandHooks(settings)) {
    writeJson(settingsPath, settings);
    console.log(`Removed CLIsponsor hooks from ${settingsPath}`);
  } else {
    console.log("No CLIsponsor Claude hooks found.");
  }
  fs.rmSync(path.join(CONFIG_DIR, "claude"), { recursive: true, force: true });
}

function uninstallGemini() {
  fs.rmSync(path.join(CONFIG_DIR, "gemini", "clisponsor_gemini_hook.mjs"), { force: true });
  try {
    fs.rmdirSync(path.join(CONFIG_DIR, "gemini"));
  } catch {}
  console.log("Removed Gemini hook script.");
}

function uninstall() {
  const target = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "all";
  if (!["all", "codex", "claude", "gemini"].includes(target)) {
    console.error("Unknown uninstall target. Use: codex, claude, gemini, or all.");
    process.exit(1);
  }
  if (target === "all" || target === "codex") uninstallCodex();
  if (target === "all" || target === "claude") uninstallClaude();
  if (target === "all" || target === "gemini") uninstallGemini();
  if (hasFlag("--config")) {
    fs.rmSync(CONFIG_PATH, { force: true });
    console.log(`Removed ${CONFIG_PATH}`);
  }
}

async function fetchProbe(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function status() {
  const cfg = config();
  if (!cfg.userId || !cfg.deviceCode) {
    console.error("Not logged in. Run: clisponsor login <email>");
    process.exit(1);
  }
  console.log(JSON.stringify({
    email: cfg.email,
    user_id: cfg.userId,
    device_code: cfg.deviceCode,
    has_device_secret: Boolean(cfg.deviceSecret),
    label: cfg.deviceLabel || null,
    serveBaseUrl: cfg.serveBaseUrl,
    backendBaseUrl: cfg.backendBaseUrl,
  }, null, 2));
}

async function doctor() {
  const cfg = config();
  const json = hasFlag("--json");
  const skipNetwork = hasFlag("--skip-network");
  const diagnostics = {
    version: HOOK_VERSION,
    configPath: CONFIG_PATH,
    configExists: fs.existsSync(CONFIG_PATH),
    serveBaseUrl: cfg.serveBaseUrl,
    backendBaseUrl: cfg.backendBaseUrl,
    loggedIn: Boolean(cfg.userId && cfg.deviceCode),
    hasDeviceSecret: Boolean(cfg.deviceSecret),
    email: cfg.email || null,
    userId: cfg.userId || null,
    deviceCode: cfg.deviceCode || null,
    installed: {
      codexPluginStaged: fs.existsSync(path.join(CONFIG_DIR, "codex-marketplace", "plugins", "clisponsor")),
      claudeSettings: fs.existsSync(path.join(HOME, ".claude", "settings.json")),
      claudeHookScript: fs.existsSync(path.join(CONFIG_DIR, "claude", "clisponsor_claude_hook.mjs")),
      geminiHookScript: fs.existsSync(path.join(CONFIG_DIR, "gemini", "clisponsor_gemini_hook.mjs")),
    },
    network: {},
  };

  if (!skipNetwork) {
    diagnostics.network.serveHealth = await fetchProbe(`${cfg.serveBaseUrl}/healthz`);
    diagnostics.network.backendHealth = await fetchProbe(`${cfg.backendBaseUrl}/healthz`);
    diagnostics.network.cliLoginEndpoint = await fetchProbe(`${cfg.backendBaseUrl}/healthz`);
  } else {
    diagnostics.network.skipped = true;
  }

  if (json) {
    console.log(JSON.stringify(diagnostics, null, 2));
    return;
  }

  console.log(`Version: ${diagnostics.version}`);
  console.log(`Config: ${diagnostics.configPath}`);
  console.log(`Logged in: ${diagnostics.loggedIn ? "yes" : "no"}`);
  if (diagnostics.email) console.log(`Email: ${diagnostics.email}`);
  if (diagnostics.deviceCode) console.log(`Device code: ${diagnostics.deviceCode}`);
  console.log(`Codex plugin staged: ${diagnostics.installed.codexPluginStaged ? "yes" : "no"}`);
  console.log(`Claude settings: ${diagnostics.installed.claudeSettings ? "yes" : "no"}`);
  console.log(`Claude hook script: ${diagnostics.installed.claudeHookScript ? "yes" : "no"}`);
  console.log(`Gemini hook script: ${diagnostics.installed.geminiHookScript ? "yes" : "no"}`);
  if (skipNetwork) {
    console.log("Network: skipped");
  } else {
    console.log(`Serve health: ${diagnostics.network.serveHealth.status || "unavailable"}`);
    console.log(`Backend health: ${diagnostics.network.backendHealth.status || "unavailable"}`);
  }
}

function help() {
  console.log(`clisponsor commands:
  clisponsor install
  clisponsor login <email> [--label=<device-label>]
  clisponsor uninstall [--config]
  clisponsor status
  clisponsor doctor [--json] [--skip-network]

Environment:
  CLISPONSOR_BACKEND_BASE_URL and CLISPONSOR_SERVE_BASE_URL override production endpoints.`);
}

const command = process.argv[2] || "help";
if (command === "login") await login();
else if (command === "install" && (!process.argv[3] || process.argv[3] === "all")) installAll();
else if (command === "uninstall") uninstall();
else if (command === "status") await status();
else if (command === "doctor") await doctor();
else if (command === "help" || command === "--help" || command === "-h") help();
else {
  console.error(`Unknown command: ${command}`);
  help();
  process.exit(1);
}
