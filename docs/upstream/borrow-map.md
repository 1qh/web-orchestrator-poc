# Upstream Borrow Map

This file tracks code inspired by or adapted from `oh-my-openagent` so we can diff and sync against newer upstream releases.

- Upstream repository: `https://github.com/code-yeongyu/oh-my-openagent`
- Upstream reference tag: `v3.11.2`
- Local project: `web-orchestrator-poc`

| Local file | Upstream reference file(s) | Borrow type | Notes |
|---|---|---|---|
| `src/lib/store.ts` | `src/tools/task/todo-sync.ts`, `src/features/background-agent/manager.ts`, `src/hooks/preemptive-compaction.ts` | adapted | Unified persistence layer for thread/run/todo/background state in SQLite + Drizzle |
| `src/lib/reminders.ts` | `src/hooks/todo-continuation-enforcer/continuation-injection.ts`, `src/features/background-agent/background-task-notification-template.ts` | adapted | System reminder injection for unfinished todos and completed background tasks |
| `src/lib/compaction.ts` | `src/hooks/preemptive-compaction.ts`, `src/hooks/compaction-context-injector/hook.ts` | adapted | Threshold-based compaction with summary handoff |
| `src/lib/background/runner.ts` | `src/features/background-agent/manager.ts`, `src/features/background-agent/task-poller.ts` | adapted | Background delegation orchestration and polling lifecycle |
| `src/lib/tools/delegation.ts` | `src/tools/delegate-task/tools.ts`, `src/tools/delegate-task/background-task.ts`, `src/tools/delegate-task/sync-task.ts` | adapted | Sync/background/parallel delegation modes |
| `src/lib/tools/todos.ts` | `src/tools/task/types.ts`, `src/tools/task/todo-sync.ts` | adapted | Todo tool schema and status lifecycle |
| `src/lib/tools/mcp.ts` | `src/features/skill-mcp-manager/http-client.ts`, `src/mcp/index.ts` | adapted | MCP server listing and tool-call bridge |
| `src/lib/mcp/manager.ts` | `src/features/skill-mcp-manager/http-client.ts`, `src/mcp/index.ts` | adapted | Streamable HTTP MCP client manager |

## Sync Checklist for New Upstream Release

1. Fetch upstream release notes and compare touched modules listed above.
2. Run a side-by-side diff for each mapped upstream file.
3. Re-evaluate local adaptations and update this map row-by-row.
4. Re-run full verification (`typecheck`, `build`, and runtime smoke checks).
