# CLIsponsor Hook

Hook package codebase for the `clisponsor` installer and Codex, Claude Code, Gemini, Antigravity, OpenCode, Pi, GitHub Copilot CLI, Qwen Code, Factory Droid, and Devin hook templates.

This codebase owns local installation, device login, diagnostics, and hook adapters. It must not contain public website, dashboard app, API account, or ad-serving server code.

Current state: authoritative public package source. Retired legacy installer notes are archived under `wiki/legacy` in the workspace.

## Commands

```bash
npx clisponsor install
npx clisponsor login <email>
npx clisponsor doctor --json
npx clisponsor uninstall all
```

`install` stages the CLIsponsor hooks/plugin for supported local tools. `login` registers this machine with the backend and writes `~/.clisponsor/config.json` with the account UUID and device code.

```bash
npx clisponsor install
npx clisponsor login carterjay@gmail.com --label="Work laptop"
```

Environment defaults:

- `CLISPONSOR_SERVE_BASE_URL`, default `https://serve.clisponsor.com`
- `CLISPONSOR_BACKEND_BASE_URL`, default `https://backend.clisponsor.com`
- `CLISPONSOR_API_BASE_URL`, legacy fallback for the serve API

For compatibility, config still writes `apiBaseUrl` as an alias for `serveBaseUrl`; hook templates prefer `serveBaseUrl` when present. Placements are always reported as `StartSession`, `StartTurn`, or `EndTurn`.

## Checks

```bash
npm run check
npm run pack:check
```
