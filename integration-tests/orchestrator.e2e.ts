import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDatabase } from "@/test-support/reset-database";
import { clearRuntimeMocks, getRuntimeMocks } from "./mock-runtime";

const mocked = getRuntimeMocks();

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

describe("orchestrator end-to-end behavior", () => {
  const previousTriggerFlag = process.env.USE_TRIGGER_DEV;
  const previousAppBaseUrl = process.env.APP_BASE_URL;
  const previousCallbackSecret = process.env.BACKGROUND_CALLBACK_SECRET;

  beforeEach(async () => {
    await resetDatabase();
    clearRuntimeMocks();

    process.env.USE_TRIGGER_DEV = "false";
    delete process.env.APP_BASE_URL;
    delete process.env.BACKGROUND_CALLBACK_SECRET;
  });

  afterEach(() => {
    if (previousTriggerFlag === undefined) {
      delete process.env.USE_TRIGGER_DEV;
    } else {
      process.env.USE_TRIGGER_DEV = previousTriggerFlag;
    }

    if (previousAppBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousAppBaseUrl;
    }

    if (previousCallbackSecret === undefined) {
      delete process.env.BACKGROUND_CALLBACK_SECRET;
    } else {
      process.env.BACKGROUND_CALLBACK_SECRET = previousCallbackSecret;
    }
  });

  it("runs local background delegation and exposes completion through polling", async () => {
    const { startBackgroundDelegation } = await import("@/lib/background/runner");
    const { ensureThread, getBackgroundTask, listRunSteps, loadThreadMessages } = await import(
      "@/lib/store"
    );
    const { GET: backgroundGet } = await import("@/app/api/background/[taskId]/route");

    const threadId = "thread_integration_local_bg";
    await ensureThread(threadId, "integration thread");

    const started = await startBackgroundDelegation({
      threadId,
      agent: "researcher",
      prompt: "Return deterministic output.",
      title: "background integration test",
    });

    expect(started.transport).toBe("local");
    expect(mocked.triggerMock).toHaveBeenCalledTimes(0);

    await waitForCompletion(started.taskId);

    const task = await getBackgroundTask(started.taskId);
    expect(task).not.toBeNull();
    expect(task?.status).toBe("completed");
    expect(task?.output).toEqual({ text: "MOCK_BACKGROUND_OK" });

    const steps = await listRunSteps(started.runId);
    expect(steps.some((step) => step.stepType === "enqueue")).toBe(true);
    expect(steps.some((step) => step.stepType === "result")).toBe(true);

    const threadMessages = await loadThreadMessages(threadId);
    expect(
      threadMessages.some(
        (message) =>
          message.role === "system" &&
          message.parts.some(
            (part) =>
              part.type === "text" &&
              part.text?.includes(`Background task ${started.taskId} completed.`),
          ),
      ),
    ).toBe(true);

    const response = await backgroundGet(new Request("http://localhost/api/background"), {
      params: Promise.resolve({ taskId: started.taskId }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      task: { id: string; status: string; output: { text: string } };
    };
    expect(payload.task.id).toBe(started.taskId);
    expect(payload.task.status).toBe("completed");
    expect(payload.task.output.text).toBe("MOCK_BACKGROUND_OK");
  });

  it("executes chat route and persists assistant output plus usage", async () => {
    const { POST: chatPost } = await import("@/app/api/chat/route");
    const { GET: threadStateGet } = await import("@/app/api/threads/[threadId]/state/route");
    const { loadThreadMessages } = await import("@/lib/store");

    const threadId = "thread_integration_chat";
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: threadId,
        messages: [
          {
            id: "msg_user_1",
            role: "user",
            parts: [{ type: "text", text: "Hello orchestrator" }],
          },
        ],
      }),
    });

    const response = await chatPost(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    expect(mocked.streamTextMock).toHaveBeenCalledTimes(1);

    const threadMessages = await loadThreadMessages(threadId);
    expect(threadMessages.length).toBeGreaterThanOrEqual(2);
    expect(
      threadMessages.some(
        (message) =>
          message.role === "assistant" &&
          message.parts.some(
            (part) => part.type === "text" && part.text?.includes("MOCK_CHAT_REPLY"),
          ),
      ),
    ).toBe(true);

    const stateResponse = await threadStateGet(new Request("http://localhost/api/threads/state"), {
      params: Promise.resolve({ threadId }),
    });
    expect(stateResponse.status).toBe(200);

    const statePayload = (await stateResponse.json()) as {
      thread: { id: string };
      messages: Array<{ role: string }>;
      usage: { totalTokens: number };
    };

    expect(statePayload.thread.id).toBe(threadId);
    expect(statePayload.messages.some((message) => message.role === "assistant")).toBe(true);
    expect(statePayload.usage.totalTokens).toBeGreaterThan(0);
  });

  it("falls back to local transport when Trigger.dev trigger fails", async () => {
    const { startBackgroundDelegation } = await import("@/lib/background/runner");
    const { ensureThread, listRunSteps } = await import("@/lib/store");

    process.env.USE_TRIGGER_DEV = "true";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.BACKGROUND_CALLBACK_SECRET = "test-secret";

    mocked.triggerMock.mockRejectedValueOnce(new Error("trigger unavailable"));

    const threadId = "thread_integration_fallback";
    await ensureThread(threadId, "trigger fallback thread");

    const started = await startBackgroundDelegation({
      threadId,
      agent: "researcher",
      prompt: "Return deterministic output.",
      title: "fallback test",
    });

    expect(mocked.triggerMock).toHaveBeenCalledTimes(1);
    expect(started.transport).toBe("local");

    await waitForCompletion(started.taskId);

    const steps = await listRunSteps(started.runId);
    expect(steps.some((step) => step.stepType === "trigger_fallback")).toBe(true);
    expect(steps.some((step) => step.stepType === "result")).toBe(true);
  });
});
