import { NextResponse } from "next/server";
import type { UIMessage } from "ai";
import { z } from "zod";

import { maybeCompactContext } from "@/lib/compaction";
import { ensureUnfinishedTodoContinuationReminder, processDueReminders } from "@/lib/reminders";
import {
  ensureThread,
  getBackgroundTask,
  getLatestCompaction,
  getThreadUsage,
  loadThreadMessages,
  persistThreadMessages,
} from "@/lib/store";
import { runDelegationTool } from "@/lib/tools/delegation";
import { listMcpServerTools, listMcpServers, runMcpTool } from "@/lib/tools/mcp";
import { runGroundedSearch } from "@/lib/tools/search";
import { runTodoTool } from "@/lib/tools/todos";

const requestSchema = z.object({
  threadId: z.string().min(1),
});

type SeedMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
};

function seededLongMessages(count: number): SeedMessage[] {
  const chunk = "context ".repeat(950);
  return Array.from({ length: count }, (_, index) => ({
    id: `msg_internal_seed_${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `${index}: ${chunk}` }],
  }));
}

function seededVisibilityMessage(): UIMessage {
  return {
    id: "msg_internal_visibility",
    role: "assistant",
    parts: [
      {
        type: "reasoning",
        text: "LIVE_REASONING_VISIBILITY_OK",
      },
      {
        type: "text",
        text: "LIVE_TEXT_VISIBILITY_OK",
      },
      {
        type: "dynamic-tool",
        toolName: "search",
        toolCallId: "live_visibility_tool_call",
        state: "output-available",
        input: {
          query: "visibility probe",
        },
        output: {
          summary: "LIVE_TOOL_VISIBILITY_OK",
        },
      },
    ],
  };
}

async function waitTask(taskId: string): Promise<void> {
  for (let attempts = 0; attempts < 80; attempts += 1) {
    const task = await getBackgroundTask(taskId);
    if (!task) {
      throw new Error(`Missing background task: ${taskId}`);
    }

    if (task.status === "completed") {
      return;
    }

    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(`Background task ended unexpectedly: ${task.errorText ?? task.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Background task timeout: ${taskId}`);
}

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = requestSchema.safeParse((await request.json().catch(() => null)) as unknown);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", detail: parsed.error.flatten() }, { status: 400 });
  }

  const { threadId } = parsed.data;
  await ensureThread(threadId, "live capability verification");

  const search = await runGroundedSearch("Give one concise update about TypeScript 5.9");

  const syncDelegation = (await runDelegationTool({
    mode: "sync",
    threadId,
    agent: "researcher",
    prompt: "Reply with SYNC_OK and one short sentence.",
  })) as { output?: string };

  const parallelSync = (await runDelegationTool({
    mode: "parallel_sync",
    threadId,
    tasks: [
      { agent: "researcher", prompt: "Reply with PARALLEL_SYNC_A" },
      { agent: "critic", prompt: "Reply with PARALLEL_SYNC_B" },
    ],
  })) as { count: number };

  const parallelBackground = (await runDelegationTool({
    mode: "parallel_background",
    threadId,
    description: "live internal capability verification",
    tasks: [
      { agent: "researcher", prompt: "Reply with PARALLEL_BG_A" },
      { agent: "critic", prompt: "Reply with PARALLEL_BG_B" },
    ],
  })) as { tasks: Array<{ task: { taskId: string } }> };

  await Promise.all(parallelBackground.tasks.map((entry) => waitTask(entry.task.taskId)));
  await processDueReminders();

  const created = (await runTodoTool({
    action: "create",
    threadId,
    content: "real capability todo",
    priority: "high",
  })) as { created?: { id: string } };

  await ensureUnfinishedTodoContinuationReminder(threadId);
  await processDueReminders();

  if (created.created?.id) {
    await runTodoTool({
      action: "update",
      threadId,
      todoId: created.created.id,
      status: "completed",
    });
  }

  const visibilityMessages = await loadThreadMessages(threadId);
  await persistThreadMessages({
    threadId,
    allMessages: [...visibilityMessages, seededVisibilityMessage()],
    model: "live-capability-model",
  });

  await persistThreadMessages({
    threadId,
    allMessages: seededLongMessages(14),
    model: "live-capability-model",
  });

  const messages = await loadThreadMessages(threadId);
  const compacted = await maybeCompactContext({ threadId, messages });
  const latestCompaction = await getLatestCompaction(threadId);
  const usage = await getThreadUsage(threadId);
  const mcpServers = listMcpServers();

  const reasoningPartVisible = messages.some((message) =>
    message.parts.some((part) => part.type === "reasoning"),
  );
  const toolPartVisible = messages.some((message) =>
    message.parts.some((part) => part.type === "dynamic-tool" || part.type.startsWith("tool-")),
  );
  const unfinishedReminderVisible = messages.some(
    (message) =>
      message.role === "system" &&
      message.parts.some(
        (part) =>
          part.type === "text" &&
          part.text.toLowerCase().includes("unfinished todo"),
      ),
  );
  const backgroundDoneReminderVisible = messages.some(
    (message) =>
      message.role === "system" &&
      message.parts.some(
        (part) =>
          part.type === "text" &&
          part.text.toLowerCase().includes("background task"),
      ),
  );

  let mcpConnectivityChecked = false;
  let mcpConnectivityOk = false;
  let mcpToolCount = 0;
  let mcpToolCallAttempted = false;
  let mcpToolCallOk = false;
  const e2eMcpToolName = process.env.E2E_MCP_TOOL_NAME;

  if (mcpServers.length > 0) {
    mcpConnectivityChecked = true;
    try {
      const firstServerName = mcpServers[0]?.name ?? "";
      const tools = await listMcpServerTools(firstServerName);
      mcpToolCount = tools.tools.length;
      mcpConnectivityOk = true;

      if (e2eMcpToolName && tools.tools.some((entry) => entry.name === e2eMcpToolName)) {
        mcpToolCallAttempted = true;
        await runMcpTool({
          serverName: firstServerName,
          toolName: e2eMcpToolName,
          toolArgs: {
            echo: "live-e2e",
          },
        });
        mcpToolCallOk = true;
      }
    } catch {
      mcpConnectivityOk = false;
    }
  }

  return NextResponse.json({
    checks: {
      searchSummaryLength: search.summary.trim().length,
      syncDelegationLength: syncDelegation.output?.trim().length ?? 0,
      parallelSyncCount: parallelSync.count,
      parallelBackgroundCount: parallelBackground.tasks.length,
      todoCreated: Boolean(created.created?.id),
      compactionTriggered: compacted.compacted,
      compactionSummaryLength: latestCompaction?.summary.trim().length ?? 0,
      usageTotalTokens: usage.totalTokens,
      mcpServerCount: mcpServers.length,
      mcpConnectivityChecked,
      mcpConnectivityOk,
      mcpToolCount,
      mcpToolCallAttempted,
      mcpToolCallOk,
      reasoningPartVisible,
      toolPartVisible,
      unfinishedReminderVisible,
      backgroundDoneReminderVisible,
    },
  });
}
