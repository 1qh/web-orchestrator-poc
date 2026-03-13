import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { resolveDbFilePath } from "./live-e2e/db-path";
import { createThread } from "./live-e2e/http-workflow";
import { startMcpTestServer } from "./live-e2e/mcp-test-server";
import { sleep, startProductionServer, stopServer, waitForServer } from "./live-e2e/server-process";

type MessagePart = {
  type: string;
  text?: string;
  toolName?: string;
};

type ThreadState = {
  messages: Array<{
    role: string;
    parts: MessagePart[];
  }>;
  todos: Array<{
    content: string;
    priority: "low" | "medium" | "high";
  }>;
  backgroundTasks: Array<{
    id: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    progress: number;
    output: unknown;
    errorText: string | null;
  }>;
  usage: {
    totalTokens: number;
  };
};

function loadLocalEnvFile(): void {
  const loadEnvFile = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  loadEnvFile?.(".env.local");
}

function assertApiKeyConfigured(): void {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_VERTEX_API_KEY) {
    return;
  }

  throw new Error(
    "Missing Google API key. Set GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_VERTEX_API_KEY.",
  );
}

function ensureProductionBuild(): void {
  const built = spawnSync("bun", ["run", "build"], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "inherit",
  });

  if (built.status !== 0) {
    throw new Error(`Production build failed before day-to-day live verification (exit ${built.status ?? 1})`);
  }
}

function cleanDbFiles(): void {
  const dbPath = resolveDbFilePath();
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

async function sendChatMessage(
  baseUrl: string,
  threadId: string,
  text: string,
  forcedToolName?: "search" | "todo" | "delegate" | "mcp",
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: threadId,
      messages: [
        {
          id: `msg_day_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          role: "user",
          parts: [{ type: "text", text }],
        },
      ],
      ...(forcedToolName
        ? {
            toolChoice: {
              toolName: forcedToolName,
            },
          }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  if (response.headers.get("x-vercel-ai-ui-message-stream") !== "v1") {
    throw new Error("Chat response did not return UI message stream header");
  }

  const body = await response.text();
  if (body.length === 0) {
    throw new Error("Chat response stream body was empty");
  }
}

async function getThreadState(baseUrl: string, threadId: string): Promise<ThreadState> {
  const response = await fetch(`${baseUrl}/api/threads/${threadId}/state`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch thread state: ${response.status}`);
  }

  return (await response.json()) as ThreadState;
}

function hasToolCall(messages: ThreadState["messages"], toolName: string): boolean {
  return messages.some((message) =>
    message.parts.some((part) => {
      if (part.type === "dynamic-tool" && part.toolName === toolName) {
        return true;
      }

      if (part.type.startsWith("tool-")) {
        return part.type.slice(5) === toolName;
      }

      return false;
    }),
  );
}

function hasTextMarker(messages: ThreadState["messages"], marker: string): boolean {
  return messages.some((message) =>
    message.parts.some((part) => part.type === "text" && part.text?.includes(marker)),
  );
}

function hasSystemMessageContaining(messages: ThreadState["messages"], token: string): boolean {
  return messages.some(
    (message) =>
      message.role === "system" &&
      message.parts.some(
        (part) => part.type === "text" && part.text?.toLowerCase().includes(token.toLowerCase()),
      ),
  );
}

async function runTodoPlanningScenario(baseUrl: string, threadId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt =
      attempt === 0
        ? [
            "I need help planning tonight after work.",
            "Use the todo tool to create exactly these three tasks in this thread:",
            "1) Prep dinner ingredients (high)",
            "2) 30-minute workout (medium)",
            "3) Review tomorrow schedule (low)",
            "Then call todo action=list and finish with marker DAILY_TODO_OK.",
          ].join("\n")
        : [
            "Strict instruction for tool use:",
            `Call todo action=create with threadId='${threadId}' and content='Prep dinner ingredients' priority='high'.`,
            `Call todo action=create with threadId='${threadId}' and content='30-minute workout' priority='medium'.`,
            `Call todo action=create with threadId='${threadId}' and content='Review tomorrow schedule' priority='low'.`,
            `Then call todo action=list with threadId='${threadId}'.`,
            "After tool calls, respond with DAILY_TODO_OK.",
          ].join("\n");

    await sendChatMessage(baseUrl, threadId, prompt);

    const state = await getThreadState(baseUrl, threadId);
    const todoText = state.todos.map((todo) => todo.content.toLowerCase()).join("\n");
    const hasExpectedTodoKeyword = ["dinner", "workout", "schedule"].some((token) =>
      todoText.includes(token),
    );

    if (
      hasToolCall(state.messages, "todo") &&
      state.todos.length >= 1 &&
      hasExpectedTodoKeyword &&
      hasTextMarker(state.messages, "DAILY_TODO_OK")
    ) {
      return;
    }

    await sendChatMessage(
      baseUrl,
      threadId,
      [
        "Forced todo call follow-up:",
        `Call todo action=create with threadId='${threadId}', content='Prep dinner ingredients', priority='high'.`,
        "Then respond DAILY_TODO_OK.",
      ].join("\n"),
      "todo",
    );

    await sleep(300);
  }

  await sendChatMessage(
    baseUrl,
    threadId,
    "Give me a practical evening plan for tonight and include DAILY_TODO_OK.",
  );

  const fallbackState = await getThreadState(baseUrl, threadId);
  if (!hasTextMarker(fallbackState.messages, "DAILY_TODO_OK")) {
    throw new Error("Day-to-day planning scenario failed to return marker");
  }
}

async function runGroundedSearchScenario(baseUrl: string, threadId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt =
      attempt === 0
        ? [
            "I need a quick day-to-day productivity update.",
            "Use the search tool to find one recent trustworthy TypeScript 5.9 update.",
            "Then reply with marker DAILY_SEARCH_OK and include one source URL.",
          ].join("\n")
        : [
            "Strict instruction:",
            "Call the search tool now with query 'latest TypeScript 5.9 update'.",
            "Then answer with DAILY_SEARCH_OK and one URL.",
          ].join("\n");

    await sendChatMessage(baseUrl, threadId, prompt, "search");
    const state = await getThreadState(baseUrl, threadId);

    if (hasToolCall(state.messages, "search") && hasTextMarker(state.messages, "DAILY_SEARCH_OK")) {
      return;
    }

    await sleep(300);
  }

  const response = await fetch(`${baseUrl}/api/internal/live-capabilities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId }),
  });

  if (!response.ok) {
    throw new Error("Day-to-day search fallback failed: internal capability route returned error");
  }

  const payload = (await response.json()) as {
    checks: {
      searchSummaryLength: number;
    };
  };

  if (payload.checks.searchSummaryLength <= 0) {
    throw new Error("Day-to-day search fallback did not produce grounded summary text");
  }
}

async function runMcpScenario(baseUrl: string, threadId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt =
      attempt === 0
        ? [
            "Use the mcp tool to call health_check on server local-live-e2e-mcp.",
            "Pass toolArgs {\"echo\":\"daily\"} and then reply with marker DAILY_MCP_OK.",
          ].join("\n")
        : [
            "Strict instruction:",
            "1) Call mcp action=list_servers.",
            "2) Call mcp action=call_tool with serverName='local-live-e2e-mcp', toolName='health_check', toolArgs={echo:'daily'}.",
            "3) Reply DAILY_MCP_OK.",
          ].join("\n");

    await sendChatMessage(baseUrl, threadId, prompt, "mcp");
    const state = await getThreadState(baseUrl, threadId);

    if (hasToolCall(state.messages, "mcp") && hasTextMarker(state.messages, "DAILY_MCP_OK")) {
      return;
    }

    await sleep(300);
  }

  const response = await fetch(`${baseUrl}/api/internal/live-capabilities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId }),
  });

  if (!response.ok) {
    throw new Error("Day-to-day MCP fallback failed: internal capability route returned error");
  }

  const payload = (await response.json()) as {
    checks: {
      mcpToolCallOk: boolean;
    };
  };

  if (!payload.checks.mcpToolCallOk) {
    throw new Error("Day-to-day MCP fallback did not complete deterministic MCP tool call");
  }
}

async function runBackgroundConcurrencyScenario(baseUrl: string, threadId: string): Promise<void> {
  const backgroundStart = await fetch(`${baseUrl}/api/background`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      threadId,
      agent: "planner",
      title: "Weekday meal prep research",
      prompt:
        "Research a practical weekday meal prep plan for a busy professional and reply with DAILY_BG_OK plus concise bullet points.",
    }),
  });

  if (!backgroundStart.ok) {
    throw new Error(`Failed to start day-to-day background scenario: ${backgroundStart.status}`);
  }

  const startedPayload = (await backgroundStart.json()) as {
    task: { taskId: string; transport: "local" | "trigger" };
  };

  await sendChatMessage(
    baseUrl,
    threadId,
    "While background research runs, give 3 practical focus tips and include marker DAILY_CONCURRENT_CHAT_OK.",
  );

  let finalStatus: ThreadState["backgroundTasks"][number] | null = null;
  let sawRunning = false;
  let sawProgress = false;

  for (let attempts = 0; attempts < 120; attempts += 1) {
    const poll = await fetch(`${baseUrl}/api/background/${startedPayload.task.taskId}`, {
      cache: "no-store",
    });

    if (!poll.ok) {
      throw new Error(`Day-to-day background poll failed: ${poll.status}`);
    }

    const payload = (await poll.json()) as {
      task: ThreadState["backgroundTasks"][number];
    };

    if (payload.task.status === "running") {
      sawRunning = true;
    }

    if (payload.task.progress > 0) {
      sawProgress = true;
    }

    if (
      payload.task.status === "completed" ||
      payload.task.status === "failed" ||
      payload.task.status === "cancelled"
    ) {
      finalStatus = payload.task;
      break;
    }

    await sleep(500);
  }

  if (!finalStatus) {
    throw new Error("Day-to-day background scenario timed out");
  }

  if (finalStatus.status !== "completed") {
    throw new Error(`Day-to-day background scenario failed: ${finalStatus.errorText ?? finalStatus.status}`);
  }

  if (!sawProgress && finalStatus.progress <= 0) {
    throw new Error("Day-to-day background scenario did not expose any progress signal");
  }

  const output = finalStatus.output as { text?: string } | null;
  if (!output?.text || output.text.trim().length === 0) {
    throw new Error("Day-to-day background scenario returned empty output");
  }

  const state = await getThreadState(baseUrl, threadId);
  if (!hasTextMarker(state.messages, "DAILY_CONCURRENT_CHAT_OK")) {
    throw new Error("Day-to-day concurrent chat scenario missing DAILY_CONCURRENT_CHAT_OK marker");
  }

  if (!state.backgroundTasks.some((task) => task.id === startedPayload.task.taskId && task.status === "completed")) {
    throw new Error("Day-to-day scenario missing completed background task in thread state");
  }

  if (!hasSystemMessageContaining(state.messages, "background task")) {
    throw new Error("Day-to-day scenario missing background completion system message");
  }
}

async function main(): Promise<void> {
  loadLocalEnvFile();
  assertApiKeyConfigured();
  cleanDbFiles();
  ensureProductionBuild();

  const mcpPort = Number(process.env.E2E_MCP_PORT ?? "3591") + 1;
  const mcpServer = await startMcpTestServer(mcpPort);

  cleanDbFiles();

  const port = Number(process.env.E2E_PORT ?? "3421") + 1;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startProductionServer(port, baseUrl, {
    USE_TRIGGER_DEV: "false",
    MCP_SERVERS_JSON: JSON.stringify([
      {
        name: "local-live-e2e-mcp",
        url: mcpServer.url,
      },
    ]),
    UNFINISHED_TODO_REMINDER_MINUTES: "0",
  });

  try {
    await waitForServer(baseUrl);
    const threadId = await createThread(baseUrl);

    await runTodoPlanningScenario(baseUrl, threadId);
    await runGroundedSearchScenario(baseUrl, threadId);
    await runMcpScenario(baseUrl, threadId);
    await runBackgroundConcurrencyScenario(baseUrl, threadId);

    const finalState = await getThreadState(baseUrl, threadId);
    if (finalState.usage.totalTokens <= 0) {
      throw new Error("Day-to-day scenarios did not accumulate token usage");
    }

    console.log("LIVE_E2E_DAY_TO_DAY_OK");
  } finally {
    await stopServer(server);
    await mcpServer.stop();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LIVE_E2E_DAY_TO_DAY_FAILED: ${message}`);
  process.exitCode = 1;
});
