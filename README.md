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

3. Trigger.dev v4 is a hard dependency for background orchestration.

- Keep `USE_TRIGGER_DEV=true` in `.env.local`.
- Run the local Trigger stack before starting the app.

## Local Trigger Self-Host (Docker)

Use a single committed compose file (`trigger-v4.compose.yml`) for local Trigger.dev v4.

Direct Docker flow:

```bash
cp trigger-v4.env.example trigger-v4.env
docker compose --env-file trigger-v4.env -f trigger-v4.compose.yml up -d
docker compose --env-file trigger-v4.env -f trigger-v4.compose.yml ps
```

Use this stack as the default and required background dependency.

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
docker compose --env-file trigger-v4.env -f trigger-v4.compose.yml down
```

To point this orchestrator at your local Trigger instance for real transport checks, set in `.env.local`:

- `USE_TRIGGER_DEV=true`
- `TRIGGER_API_URL=http://localhost:18030`
- `TRIGGER_SECRET_KEY=<your self-host API key or PAT>` or `TRIGGER_ACCESS_TOKEN=<token>`
- `TRIGGER_PROJECT_REF=<your project ref>`
- `BACKGROUND_CALLBACK_SECRET=<random secret>`

For `test:e2e:live:trigger`, also set:

- `TRIGGER_ACCESS_TOKEN=<personal access token (tr_pat_...) for CLI auth>`

4. Install and run app (after Trigger stack is up):

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
# Real day-to-day scenario simulation (planning/search/background/MCP in production mode)
bun run test:e2e:live:day-to-day
# Extended non-mock capability verification (real HTTP + real tools + real persistence)
# Includes deterministic local MCP server startup and strict MCP tool-call assertions
bun run test:e2e:live:full
# Optional: real Trigger.dev transport verification (requires TRIGGER_PROJECT_REF + TRIGGER_SECRET_KEY, and TRIGGER_ACCESS_TOKEN for spawned CLI worker auth)
bun run test:e2e:live:trigger
# One-command reproducible self-host proof: docker compose up + bootstrap + strict live verification matrix
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
docker compose --env-file trigger-v4.env -f trigger-v4.compose.yml down -v --remove-orphans
docker compose --env-file trigger-v4.env -f trigger-v4.compose.yml up -d
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
