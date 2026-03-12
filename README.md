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

4. Install and run:

```bash
bun install
bun run dev
```

Open `http://localhost:3000`.

## Verify

```bash
bun run lint
bun run typecheck
bun test
bun run test:e2e
# Requires valid Google API key in .env.local
bun run test:e2e:live
bun run build
```

## Security

- `.env*` is gitignored in this repo.
- Never commit `.env.local`.
