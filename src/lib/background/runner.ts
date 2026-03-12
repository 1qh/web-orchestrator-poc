// Reference notes from oh-my-openagent:
// - src/features/background-agent/manager.ts
// - src/features/background-agent/task-poller.ts
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { tasks } from "@trigger.dev/sdk/v3";

import { DEFAULT_MODEL } from "@/lib/config";
import { getAgentInstruction } from "@/lib/agents";
import { createBackgroundCompletionReminder } from "@/lib/reminders";
import {
  addRunStep,
  appendSystemMessage,
  createBackgroundTask,
  createRun,
  getBackgroundTask,
  updateBackgroundTask,
  updateRunStatus,
} from "@/lib/store";

const localInFlight = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function canUseTrigger(): boolean {
  return (
    process.env.USE_TRIGGER_DEV === "true" &&
    Boolean(process.env.APP_BASE_URL) &&
    Boolean(process.env.BACKGROUND_CALLBACK_SECRET)
  );
}

async function runDelegation(agent: string, prompt: string): Promise<string> {
  const result = await generateText({
    model: google(DEFAULT_MODEL),
    system: getAgentInstruction(agent),
    prompt,
  });

  return result.text;
}

async function runLocalBackgroundTask(args: {
  backgroundTaskId: string;
  runId: string;
  threadId: string;
  agent: string;
  prompt: string;
}): Promise<void> {
  if (localInFlight.has(args.backgroundTaskId)) {
    return;
  }

  localInFlight.add(args.backgroundTaskId);

  try {
    await updateBackgroundTask({
      taskId: args.backgroundTaskId,
      status: "running",
      progress: 10,
    });
    await updateRunStatus(args.runId, "background");
    await addRunStep({
      runId: args.runId,
      threadId: args.threadId,
      stepType: "status",
      content: { message: "Background task started", progress: 10 },
    });

    await sleep(250);
    await updateBackgroundTask({
      taskId: args.backgroundTaskId,
      progress: 35,
    });

    const text = await runDelegation(args.agent, args.prompt);

    await sleep(250);
    await updateBackgroundTask({
      taskId: args.backgroundTaskId,
      progress: 85,
    });

    await updateBackgroundTask({
      taskId: args.backgroundTaskId,
      status: "completed",
      progress: 100,
      output: {
        text,
      },
    });

    await updateRunStatus(args.runId, "completed");

    await addRunStep({
      runId: args.runId,
      threadId: args.threadId,
      stepType: "result",
      content: { taskId: args.backgroundTaskId, text },
    });

    await appendSystemMessage(
      args.threadId,
      `Background task ${args.backgroundTaskId} completed.`,
      {
        reminderType: "background_done",
        taskId: args.backgroundTaskId,
        source: "local-runner",
      },
    );

    await createBackgroundCompletionReminder({
      threadId: args.threadId,
      backgroundTaskId: args.backgroundTaskId,
      description: `${args.agent} delegation`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateBackgroundTask({
      taskId: args.backgroundTaskId,
      status: "failed",
      errorText: message,
    });
    await updateRunStatus(args.runId, "failed", message);
    await appendSystemMessage(
      args.threadId,
      `Background task ${args.backgroundTaskId} failed: ${message}`,
      {
        reminderType: "background_done",
        taskId: args.backgroundTaskId,
        source: "local-runner",
      },
    );
  } finally {
    localInFlight.delete(args.backgroundTaskId);
  }
}

export async function startBackgroundDelegation(args: {
  threadId: string;
  agent: string;
  prompt: string;
  title: string;
  parentRunId?: string;
}): Promise<{ taskId: string; runId: string; transport: "trigger" | "local" }> {
  const runId = await createRun({
    threadId: args.threadId,
    mode: "background",
    agent: args.agent,
    title: args.title,
    parentRunId: args.parentRunId,
    model: DEFAULT_MODEL,
  });

  const taskId = await createBackgroundTask({
    threadId: args.threadId,
    runId,
    taskType: "delegation",
    agent: args.agent,
    input: {
      prompt: args.prompt,
      title: args.title,
    },
  });

  await addRunStep({
    runId,
    threadId: args.threadId,
    stepType: "enqueue",
    content: { taskId, mode: "background" },
  });

  if (canUseTrigger()) {
    try {
      const handle = await tasks.trigger("background-delegation", {
        taskId,
        runId,
        threadId: args.threadId,
        agent: args.agent,
        prompt: args.prompt,
        callbackUrl: `${process.env.APP_BASE_URL}/api/internal/background-callback`,
        callbackSecret: process.env.BACKGROUND_CALLBACK_SECRET,
      });

      await updateBackgroundTask({
        taskId,
        status: "running",
        progress: 5,
        triggerRunId: handle.id,
      });

      await updateRunStatus(runId, "background");

      return { taskId, runId, transport: "trigger" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await addRunStep({
        runId,
        threadId: args.threadId,
        stepType: "trigger_fallback",
        content: {
          taskId,
          reason: message,
        },
      });
    }
  }

  void runLocalBackgroundTask({
    backgroundTaskId: taskId,
    runId,
    threadId: args.threadId,
    agent: args.agent,
    prompt: args.prompt,
  });

  return { taskId, runId, transport: "local" };
}

export async function pollBackgroundTask(taskId: string): ReturnType<typeof getBackgroundTask> {
  return getBackgroundTask(taskId);
}
