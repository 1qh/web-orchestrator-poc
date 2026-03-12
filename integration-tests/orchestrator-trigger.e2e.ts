import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDatabase } from "@/test-support/reset-database";
import { clearRuntimeMocks, getRuntimeMocks } from "./mock-runtime";

const mocked = getRuntimeMocks();

describe("orchestrator Trigger.dev transport", () => {
  const previousTriggerFlag = process.env.USE_TRIGGER_DEV;
  const previousAppBaseUrl = process.env.APP_BASE_URL;
  const previousCallbackSecret = process.env.BACKGROUND_CALLBACK_SECRET;

  beforeEach(async () => {
    await resetDatabase();
    clearRuntimeMocks();

    process.env.USE_TRIGGER_DEV = "true";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.BACKGROUND_CALLBACK_SECRET = "trigger-secret";
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

  it("uses trigger transport when trigger invocation succeeds", async () => {
    const { ensureThread, getBackgroundTask, listRunSteps } = await import("@/lib/store");
    const { startBackgroundDelegation } = await import("@/lib/background/runner");

    mocked.triggerMock.mockResolvedValueOnce({ id: "trigger_run_ok" });

    const threadId = "thread_trigger_transport";
    await ensureThread(threadId, "trigger transport thread");

    const started = await startBackgroundDelegation({
      threadId,
      agent: "researcher",
      prompt: "use trigger transport",
      title: "trigger transport",
    });

    expect(started.transport).toBe("trigger");
    expect(mocked.triggerMock).toHaveBeenCalledTimes(1);
    expect(mocked.triggerMock).toHaveBeenCalledWith(
      "background-delegation",
      expect.objectContaining({
        taskId: started.taskId,
        runId: started.runId,
        threadId,
        callbackUrl: "http://localhost:3000/api/internal/background-callback",
        callbackSecret: "trigger-secret",
      }),
    );

    const task = await getBackgroundTask(started.taskId);
    expect(task?.status).toBe("running");
    expect(task?.progress).toBe(5);
    expect(task?.triggerRunId).toBe("trigger_run_ok");

    const steps = await listRunSteps(started.runId);
    expect(steps.some((step) => step.stepType === "enqueue")).toBe(true);
    expect(steps.some((step) => step.stepType === "trigger_fallback")).toBe(false);
  });

  it("accepts trigger callback completion and persists output", async () => {
    const { ensureThread, getBackgroundTask, loadThreadMessages } = await import("@/lib/store");
    const { startBackgroundDelegation } = await import("@/lib/background/runner");
    const { POST: callbackPost } = await import("@/app/api/internal/background-callback/route");

    mocked.triggerMock.mockResolvedValueOnce({ id: "trigger_run_cb" });

    const threadId = "thread_trigger_callback";
    await ensureThread(threadId, "trigger callback thread");

    const started = await startBackgroundDelegation({
      threadId,
      agent: "researcher",
      prompt: "wait for callback",
      title: "trigger callback",
    });

    expect(started.transport).toBe("trigger");

    const callbackResponse = await callbackPost(
      new Request("http://localhost/api/internal/background-callback", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": "trigger-secret",
        },
        body: JSON.stringify({
          taskId: started.taskId,
          runId: started.runId,
          threadId,
          status: "completed",
          progress: 100,
          output: { text: "TRIGGER_COMPLETED" },
        }),
      }),
    );

    expect(callbackResponse.status).toBe(200);

    const task = await getBackgroundTask(started.taskId);
    expect(task?.status).toBe("completed");
    expect(task?.output).toEqual({ text: "TRIGGER_COMPLETED" });

    const messages = await loadThreadMessages(threadId);
    expect(
      messages.some(
        (message) =>
          message.role === "system" &&
          message.parts.some(
            (part) =>
              part.type === "text" &&
              part.text?.includes(`Background task ${started.taskId} completed (Trigger.dev).`),
          ),
      ),
    ).toBe(true);
  });
});
