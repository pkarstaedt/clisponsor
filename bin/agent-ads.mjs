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
    installToken: raw.installToken || "",
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

function isClisponsorCommand(value) {
  return (
    typeof value === "string" &&
    (value.includes("cliads_claude_hook.mjs") ||
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

function login() {
  const next = config();
  const tokenArg = argValue("--token");
  const tokenFileArg = argValue("--token-file");
  const codeArg = argValue("--code");
  const legacyApiArg = argValue("--api");
  const serveApiArg = argValue("--serve-api");
  const backendApiArg = argValue("--backend-api");

  if (tokenArg) next.installToken = tokenArg;
  else if (tokenFileArg) next.installToken = fs.readFileSync(tokenFileArg, "utf8").trim();
  else if (codeArg) {
    next.installToken = codeArg;
    console.error("Legacy --code accepted as an install token alias. Prefer --token=<install-token>.");
  }
  if (legacyApiArg) {
    next.serveBaseUrl = normalizeBaseUrl(legacyApiArg);
    next.backendBaseUrl = normalizeBaseUrl(legacyApiArg);
  }
  if (serveApiArg) next.serveBaseUrl = normalizeBaseUrl(serveApiArg);
  if (backendApiArg) next.backendBaseUrl = normalizeBaseUrl(backendApiArg);
  next.apiBaseUrl = next.serveBaseUrl;

  writeJson(CONFIG_PATH, next);
  console.log(`Wrote ${CONFIG_PATH}`);
}

function installCodex() {
  const cfg = config();
  const pluginRoot = path.join(CONFIG_DIR, "codex-plugin");
  copyDir(path.join(ROOT, "templates", "codex-plugin"), pluginRoot);
  patchFile(path.join(pluginRoot, "hooks", "hooks.json"), {
    "__CLIADS_HOOK_SCRIPT__": path.join(pluginRoot, "scripts", "cliads_codex_hook.mjs"),
  });
  patchFile(path.join(pluginRoot, "scripts", "cliads_codex_hook.mjs"), {
    "__CLIADS_CONFIG_PATH__": CONFIG_PATH,
  });
  chmodExecutable(path.join(pluginRoot, "scripts", "cliads_codex_hook.mjs"));

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
  console.log(`Codex plugin staged. Serve API: ${cfg.serveBaseUrl}`);
  console.log("Run: codex plugin add clisponsor@clisponsor-local");
}

function installClaude() {
  const cfg = config();
  const claudeDir = path.join(CONFIG_DIR, "claude");
  const installedHook = path.join(claudeDir, "cliads_claude_hook.mjs");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "templates", "claude", "cliads_claude_hook.mjs"), installedHook);
  chmodExecutable(installedHook);

  const settingsPath = path.join(HOME, ".claude", "settings.json");
  const settings = readEditableJson(settingsPath, {});
  addClaudeCommandHook(settings, "SessionStart", `node ${JSON.stringify(installedHook)} SessionStart`);
  addClaudeCommandHook(settings, "UserPromptSubmit", `node ${JSON.stringify(installedHook)} UserPromptSubmit`);
  addClaudeCommandHook(settings, "Stop", `node ${JSON.stringify(installedHook)} Stop`);
  writeJson(settingsPath, settings);
  console.log(`Updated ${settingsPath}`);
  console.log(`Claude hook installed. Serve API: ${cfg.serveBaseUrl}`);
}

function geminiHookSource() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(CONFIG_PATH)}, "utf8"));
const event = process.argv[2] || "StartTurn";
const serveBaseUrl = cfg.serveBaseUrl || cfg.apiBaseUrl;
try {
  if (!serveBaseUrl || !cfg.installToken) process.exit(0);
  const body = { client: "Gemini", hook_event: event, placement: event, idempotency_key: crypto.randomUUID(), metadata: { hookVersion: ${JSON.stringify(HOOK_VERSION)} } };
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const canonical = ["v1", timestamp, nonce, body.client || "", body.hook_event || "", body.placement || "", body.idempotency_key || "", body.user_id || ""].join("\\n");
  const signature = crypto.createHmac("sha256", cfg.installToken).update(canonical).digest("hex");
  const res = await fetch(serveBaseUrl + "/v1/ads/serve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + cfg.installToken,
      "x-clisponsor-timestamp": timestamp,
      "x-clisponsor-nonce": nonce,
      "x-clisponsor-signature": "sha256=" + signature,
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
  const cfg = config();
  const geminiDir = path.join(CONFIG_DIR, "gemini");
  fs.mkdirSync(geminiDir, { recursive: true });
  const hookPath = path.join(geminiDir, "clisponsor_gemini_hook.mjs");
  fs.writeFileSync(hookPath, geminiHookSource(), { mode: 0o755 });
  console.log(`Gemini hook script written: ${hookPath}`);
  console.log(`Configure Gemini to run: node ${JSON.stringify(hookPath)} StartTurn`);
  console.log(`Serve API: ${cfg.serveBaseUrl}`);
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
  if (!cfg.installToken) {
    console.error("Not logged in. Run: clisponsor login --token=<install-token>");
    process.exit(1);
  }
  const res = await fetch(`${cfg.backendBaseUrl}/v1/publisher/stats`, {
    headers: { authorization: `Bearer ${cfg.installToken}` },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  console.log(JSON.stringify(await res.json(), null, 2));
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
    loggedIn: Boolean(cfg.installToken),
    installed: {
      codexPluginStaged: fs.existsSync(path.join(CONFIG_DIR, "codex-marketplace", "plugins", "clisponsor")),
      claudeSettings: fs.existsSync(path.join(HOME, ".claude", "settings.json")),
      claudeHookScript: fs.existsSync(path.join(CONFIG_DIR, "claude", "cliads_claude_hook.mjs")),
      geminiHookScript: fs.existsSync(path.join(CONFIG_DIR, "gemini", "clisponsor_gemini_hook.mjs")),
    },
    network: {},
  };

  if (!skipNetwork) {
    diagnostics.network.serveHealth = await fetchProbe(`${cfg.serveBaseUrl}/healthz`);
    diagnostics.network.backendHealth = await fetchProbe(`${cfg.backendBaseUrl}/healthz`);
    diagnostics.network.publisherStats = cfg.installToken
      ? await fetchProbe(`${cfg.backendBaseUrl}/v1/publisher/stats`, {
          authorization: `Bearer ${cfg.installToken}`,
        })
      : { ok: false, skipped: "not logged in" };
  } else {
    diagnostics.network.skipped = true;
  }

  if (json) {
    console.log(JSON.stringify(diagnostics, null, 2));
    return;
  }

  console.log(`Version: ${diagnostics.version}`);
  console.log(`Config: ${diagnostics.configPath}`);
  console.log(`Serve API: ${diagnostics.serveBaseUrl}`);
  console.log(`Backend API: ${diagnostics.backendBaseUrl}`);
  console.log(`Logged in: ${diagnostics.loggedIn ? "yes" : "no"}`);
  console.log(`Codex plugin staged: ${diagnostics.installed.codexPluginStaged ? "yes" : "no"}`);
  console.log(`Claude settings: ${diagnostics.installed.claudeSettings ? "yes" : "no"}`);
  console.log(`Claude hook script: ${diagnostics.installed.claudeHookScript ? "yes" : "no"}`);
  console.log(`Gemini hook script: ${diagnostics.installed.geminiHookScript ? "yes" : "no"}`);
  if (skipNetwork) {
    console.log("Network: skipped");
  } else {
    console.log(`Serve health: ${diagnostics.network.serveHealth.status || "unavailable"}`);
    console.log(`Backend health: ${diagnostics.network.backendHealth.status || "unavailable"}`);
    console.log(`Publisher stats: ${diagnostics.network.publisherStats.status || diagnostics.network.publisherStats.skipped || "unavailable"}`);
  }
}

function help() {
  console.log(`clisponsor commands:
  clisponsor login --token=<install-token> [--serve-api=<url>] [--backend-api=<url>]
  clisponsor login --token-file=<path> [--serve-api=<url>] [--backend-api=<url>]
  clisponsor install codex
  clisponsor install claude
  clisponsor install gemini
  clisponsor uninstall [codex|claude|gemini|all] [--config]
  clisponsor status
  clisponsor doctor [--json] [--skip-network]

Legacy compatibility:
  legacy: clisponsor login --code=<install-token> [--serve-api=<url>] [--backend-api=<url>]
    Accepted as an install token alias; prefer --token for new installs.

Automation:
  Use --token-file so install tokens do not appear in process argv.`);
}

const command = process.argv[2] || "help";
if (command === "login" || command === "configure") login();
else if (command === "install" && process.argv[3] === "codex") installCodex();
else if (command === "install" && process.argv[3] === "claude") installClaude();
else if (command === "install" && process.argv[3] === "gemini") installGemini();
else if (command === "uninstall") uninstall();
else if (command === "status") await status();
else if (command === "doctor") await doctor();
else help();
