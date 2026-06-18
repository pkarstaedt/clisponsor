# CLIsponsor Hook

Hook package codebase for the `clisponsor` installer and Codex, Claude Code, and Gemini hook templates.

This codebase owns local installation, config, request signing, diagnostics, and hook adapters. It must not contain public website, dashboard app, API account, or ad-serving server code.

Current state: authoritative public package source. Retired legacy installer notes are archived under `wiki/legacy` in the workspace.

## Commands

```bash
npx clisponsor add <install-token>
npx clisponsor doctor --json
npx clisponsor uninstall all
```

`add` writes `~/.clisponsor/config.json` and installs the CLIsponsor hooks/plugin for supported local tools in one run.

```bash
npx clisponsor add <install-token>
```

Environment defaults:

- `CLISPONSOR_SERVE_BASE_URL`, default `https://serve.clisponsor.com`
- `CLISPONSOR_BACKEND_BASE_URL`, default `https://backend.clisponsor.com`
- `CLISPONSOR_API_BASE_URL`, legacy fallback for the serve API

For compatibility, config still writes `apiBaseUrl` as an alias for `serveBaseUrl`; hook templates prefer `serveBaseUrl` when present.

## Checks

```bash
npm run check
npm run pack:check
```
