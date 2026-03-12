import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDatabase } from "@/test-support/reset-database";
import { clearRuntimeMocks, getRuntimeMocks } from "./mock-runtime";

const mocked = getRuntimeMocks();

type ToolDefinition = { execute: (input: unknown) => Promise<unknown> };

type StreamInvocation = { tools: Record<string, ToolDefinition> };

async function postChat(threadId: string, text: string): Promise<void> {
  const { POST: chatPost } = await import("@/app/api/chat/route");
  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: threadId,
      messages: [
        {
          id: `msg_${threadId}`,
          role: "user",
          parts: [{ type: "text", text }],
        },
      ],
    }),
  });

  expect((await chatPost(request)).status).toBe(200);
}

function latestStreamInvocation(): StreamInvocation {
  const calls = mocked.streamTextMock.mock.calls;
  const latest = calls.at(-1)?.[0] as StreamInvocation | undefined;
  if (!latest) {
    throw new Error("expected streamText to be called");
  }

  return latest;
}

async function waitForCompletion(taskId: string): Promise<void> {
  const { getBackgroundTask } = await import("@/lib/store");

  for (let attempts = 0; attempts < 40; attempts++) {
    const task = await getBackgroundTask(taskId);
    if (task && (task.status === "completed" || task.status === "failed")) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`background task did not complete: ${taskId}`);
}

describe("orchestrator capability coverage", () => {
  const previousTriggerFlag = process.env.USE_TRIGGER_DEV;

  beforeEach(async () => {
    await resetDatabase();
    clearRuntimeMocks();
    process.env.USE_TRIGGER_DEV = "false";
  });

  afterEach(() => {
    if (previousTriggerFlag === undefined) {
      delete process.env.USE_TRIGGER_DEV;
      return;
    }

    process.env.USE_TRIGGER_DEV = previousTriggerFlag;
  });

  it("executes configured tools for search, todo, delegate parallel modes, and MCP", async () => {
    mocked.generateTextMock.mockImplementation(async () => {
      return {
        text: "MOCK_SEARCH_SUMMARY",
        sources: [{ type: "source", sourceType: "url", title: "A", url: "https://a.example" }],
        providerMetadata: {
          google: {
            groundingMetadata: {
              searchEntryPoint: "ok",
            },
          },
        },
      } as unknown as { text: string };
    });

    await postChat("thread_capabilities_tools", "Open tools");

    const tools = latestStreamInvocation().tools;

    const searchResult = (await tools.search.execute({ query: "latest launch" })) as {
      summary: string;
      sources: Array<{ url?: string }>;
    };
    expect(searchResult.summary).toBe("MOCK_SEARCH_SUMMARY");
    expect(searchResult.sources[0]?.url).toBe("https://a.example");
    expect(mocked.googleSearchToolMock).toHaveBeenCalledTimes(1);

    const todoCreated = (await tools.todo.execute({
      action: "create",
      threadId: "thread_capabilities_tools",
      content: "Verify todo wiring",
      priority: "high",
    })) as { created: { id: string } };
    expect(todoCreated.created.id.length).toBeGreaterThan(0);

    const todoList = (await tools.todo.execute({
      action: "list",
      threadId: "thread_capabilities_tools",
    })) as { todos: Array<{ content: string }> };
    expect(todoList.todos.some((todo) => todo.content === "Verify todo wiring")).toBe(true);

    const parallelSync = (await tools.delegate.execute({
      mode: "parallel_sync",
      threadId: "thread_capabilities_tools",
      tasks: [
        { agent: "researcher", prompt: "task 1" },
        { agent: "critic", prompt: "task 2" },
      ],
    })) as { mode: string; count: number };
    expect(parallelSync.mode).toBe("parallel_sync");
    expect(parallelSync.count).toBe(2);

    const parallelBackground = (await tools.delegate.execute({
      mode: "parallel_background",
      threadId: "thread_capabilities_tools",
      tasks: [
        { agent: "researcher", prompt: "bg task 1" },
        { agent: "critic", prompt: "bg task 2" },
      ],
      description: "parallel background integration",
    })) as {
      mode: string;
      tasks: Array<{ task: { taskId: string } }>;
    };

    expect(parallelBackground.mode).toBe("parallel_background");
    expect(parallelBackground.tasks.length).toBe(2);
    await Promise.all(parallelBackground.tasks.map((entry) => waitForCompletion(entry.task.taskId)));

    const mcpServers = (await tools.mcp.execute({ action: "list_servers" })) as {
      servers: Array<unknown>;
    };
    expect(Array.isArray(mcpServers.servers)).toBe(true);
  });

  it("creates unfinished and background completion reminder messages", async () => {
    const { createTodo, ensureThread, loadThreadMessages } = await import("@/lib/store");
    const { startBackgroundDelegation } = await import("@/lib/background/runner");
    const { GET: threadStateGet } = await import("@/app/api/threads/[threadId]/state/route");

    const threadId = "thread_capabilities_reminders";
    await ensureThread(threadId, "reminder thread");
    await createTodo({ threadId, content: "unfinished item", priority: "medium" });

    await postChat(threadId, "check reminders");

    const started = await startBackgroundDelegation({
      threadId,
      agent: "researcher",
      prompt: "complete in background",
      title: "background for reminder",
    });
    await waitForCompletion(started.taskId);

    const stateResponse = await threadStateGet(new Request("http://localhost/api/threads/state"), {
      params: Promise.resolve({ threadId }),
    });
    expect(stateResponse.status).toBe(200);

    const messages = await loadThreadMessages(threadId);
    expect(
      messages.some(
        (message) =>
          message.role === "system" &&
          message.parts.some(
            (part) =>
              part.type === "text" &&
              part.text?.includes("You have 1 unfinished todo item(s). Continue from where you left off."),
          ),
      ),
    ).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.role === "system" &&
          message.parts.some(
            (part) =>
              part.type === "text" &&
              part.text?.includes("Background task completed: researcher delegation"),
          ),
      ),
    ).toBe(true);
  });
});
