# Web Orchestrator (Self-Hosted)

Web-first orchestrator prototype using Next.js 16, React 19, Bun, AI SDK v6, Drizzle, and SQLite.

## Local Setup (Safe)

1. Copy env template:

```bash
cp .env.example .env.local
```

2. Set your key in `.env.local` (server-side only):

- `GOOGLE_VERTEX_API_KEY` (supported by this app)
- `GOOGLE_GENERATIVE_AI_API_KEY` (SDK-native key name)

The app auto-aliases `GOOGLE_VERTEX_API_KEY` to `GOOGLE_GENERATIVE_AI_API_KEY` at runtime.

3. Keep self-host mode enabled:

- `USE_TRIGGER_DEV=false`

This forces background delegations through the local runner (no Trigger.dev remote execution).

Trigger.dev Docker note:

- You typically will not see a local Trigger.dev Docker container in this setup.
- This project defaults to local in-process background execution unless `USE_TRIGGER_DEV=true` and Trigger credentials are configured.
- Real Trigger transport verification is provided by `bun run test:e2e:live:trigger`.

## Local Trigger Self-Host (Docker)

This project now includes reproducible scripts to run a local self-hosted Trigger.dev v4 stack.

```bash
bun run trigger:selfhost:reset
bun run trigger:selfhost:start
bun run trigger:selfhost:status
```

The scripts clone official Trigger.dev docker assets into `.data/trigger-selfhost/trigger.dev` and run the combined webapp+worker stack.

- Dashboard: `http://localhost:18030`
- MinIO console: `http://localhost:19001`

To fetch the bootstrap worker token from logs:

```bash
bun run trigger:selfhost:worker-token
```

To deterministically seed a local project/environment plus a fresh CLI PAT for strict live tests:

```bash
bun run trigger:selfhost:bootstrap
```

To export these values into your current shell (recommended for strict e2e):

```bash
eval "$(bun run trigger:selfhost:bootstrap --exports-only)"
```

Stop the local self-host stack:

```bash
bun run trigger:selfhost:stop
```

To point this orchestrator at your local Trigger instance for real transport checks, set in `.env.local`:

- `USE_TRIGGER_DEV=true`
- `TRIGGER_API_URL=http://localhost:18030`
- `TRIGGER_SECRET_KEY=<your self-host API key or PAT>` or `TRIGGER_ACCESS_TOKEN=<token>`
- `TRIGGER_PROJECT_REF=<your project ref>`
- `BACKGROUND_CALLBACK_SECRET=<random secret>`

For `test:e2e:live:trigger`, also set:

- `TRIGGER_ACCESS_TOKEN=<personal access token (tr_pat_...) for CLI auth>`

4. Install and run:

```bash
bun install
bun run dev
```

Open `http://localhost:3000`.

## Verify

For a full production-like verification checklist and expected success markers, see:

- `docs/real-verification.md`

```bash
bun run lint
bun run typecheck
bun test
bun run test:e2e
# Requires valid Google API key in .env.local
bun run test:e2e:live
# Extended non-mock capability verification (real HTTP + real tools + real persistence)
# Includes deterministic local MCP server startup and strict MCP tool-call assertions
bun run test:e2e:live:full
# Optional: real Trigger.dev transport verification (requires TRIGGER_PROJECT_REF + TRIGGER_SECRET_KEY, and TRIGGER_ACCESS_TOKEN for spawned CLI worker auth)
bun run test:e2e:live:trigger
# One-command reproducible self-host proof: reset/start/bootstrap Trigger + run strict live verification matrix
bun run test:e2e:proof:selfhost
bun run build
```

`test:e2e:live:trigger` behavior:

- If `TRIGGER_PROJECT_REF` and one of `TRIGGER_SECRET_KEY`/`TRIGGER_ACCESS_TOKEN` are set, it attempts real Trigger transport verification.
- For reproducible non-interactive runs (especially CI), set `TRIGGER_ACCESS_TOKEN` to a PAT (`tr_pat_...`) so `trigger.dev dev` does not require browser login.
- If they are missing, it exits successfully with `LIVE_E2E_TRIGGER_SKIPPED`.
- Set `E2E_REQUIRE_TRIGGER=true` to make missing Trigger credentials fail the run.

Recommended reproducible strict local self-host check sequence:

```bash
bun run trigger:selfhost:reset
bun run trigger:selfhost:start
eval "$(bun run trigger:selfhost:bootstrap --exports-only)"
E2E_REQUIRE_TRIGGER=true bun run test:e2e:live:trigger
```

Single-command full self-host evidence run:

```bash
bun run test:e2e:proof:selfhost
```

For strict real Trigger transport checks, set in `.env.local`:

- `USE_TRIGGER_DEV=true`
- `TRIGGER_PROJECT_REF=...`
- `TRIGGER_SECRET_KEY=...`
- `TRIGGER_ACCESS_TOKEN=...` (PAT for CLI `dev` auth)
- `BACKGROUND_CALLBACK_SECRET=...`

## Security

- `.env*` is gitignored in this repo.
- Never commit `.env.local`.
