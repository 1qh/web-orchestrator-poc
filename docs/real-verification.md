# Real Verification Guide (No Mock-Only Path)

This guide verifies the orchestrator in a production-like local setup:

- real Next.js production build
- real SQLite persistence
- real AI model calls (Gemini)
- real grounded search calls
- real MCP connectivity and real MCP tool call
- real Trigger.dev self-host transport for background tasks

## 1) Prerequisites

1. Install dependencies:

```bash
bun install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Set at least one model key in `.env.local`:

- `GOOGLE_GENERATIVE_AI_API_KEY=...`
- or `GOOGLE_VERTEX_API_KEY=...`

4. Ensure Docker is running.

## 2) One-Command Full Proof

Run:

```bash
bun run test:e2e:proof:selfhost
```

This command performs all of the following in sequence:

1. `trigger:selfhost:reset`
2. `trigger:selfhost:start`
3. `trigger:selfhost:status`
4. `trigger:selfhost:bootstrap --exports-only`
5. `typecheck`
6. `test:e2e`
7. `test:e2e:live:full`
8. `test:e2e:live:trigger`
9. `build`
10. `trigger:selfhost:stop` (cleanup)

## 3) Success Markers

Treat verification as successful only if you see all of these markers:

- `TRIGGER_SELFHOST_STATUS_OK`
- `LIVE_E2E_FULL_OK`
- `LIVE_E2E_TRIGGER_OK`
- `LIVE_E2E_PROOF_OK`

## 4) What Is Proven by This Run

- parallel sync/background delegation
- grounded search capability
- MCP connectivity plus deterministic MCP tool execution
- sync tool execution routed through server actions (`src/app/tool-actions.ts`)
- todo creation/update flow
- unfinished todo continuation reminder
- background completion reminder
- background task polling and completion state
- reasoning/text/tool-call visibility path persistence
- non-blocking conversation while background task executes
- token usage accumulation
- context compaction path
- real Trigger self-host transport path

## 5) Optional Manual Breakdown

If you want to run each phase manually:

```bash
bun run trigger:selfhost:reset
bun run trigger:selfhost:start
bun run trigger:selfhost:status
eval "$(bun run trigger:selfhost:bootstrap --exports-only)"
E2E_REQUIRE_TRIGGER=true bun run test:e2e:live:trigger
bun run test:e2e:live:full
```

## 6) Common Failure Causes

- missing model key in `.env.local`
- Docker not running
- occupied local ports needed by Trigger self-host stack
- invalid or missing self-host bootstrap exports

When troubleshooting, start with:

```bash
bun run trigger:selfhost:status
```
