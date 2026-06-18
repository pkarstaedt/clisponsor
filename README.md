# CLIsponsor Hook

Hook package codebase for the `clisponsor` installer and Codex, Claude Code, and Gemini hook templates.

This codebase owns local installation, config, request signing, diagnostics, and hook adapters. It must not contain public website, dashboard app, API account, or ad-serving server code.

Current state: authoritative public package source. The retired legacy installer notes are archived under `wiki/legacy/cliads-network/installer.md` in the workspace.

## Commands

```bash
npx clisponsor login --token=<install-token>
npx clisponsor install codex
npx clisponsor install claude
npx clisponsor install gemini
npx clisponsor doctor --json
npx clisponsor uninstall all
```

`login` writes `~/.clisponsor/config.json`. The hook-facing serve API and account/stats backend API are configured separately:

```bash
npx clisponsor login \
  --token=<install-token> \
  --serve-api=https://serve.clisponsor.com \
  --backend-api=https://backend.clisponsor.com
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
