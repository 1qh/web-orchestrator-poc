import { sleep } from "./server-process";

type BackgroundStartPayload = {
  task: { taskId: string; transport: "local" | "trigger" };
};

async function waitTaskDone(baseUrl: string, taskId: string): Promise<void> {
  for (let attempts = 0; attempts < 80; attempts++) {
    const response = await fetch(`${baseUrl}/api/background/${taskId}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Background poll failed during non-blocking check: ${response.status}`);
    }

    const payload = (await response.json()) as {
      task: { status: "pending" | "running" | "completed" | "failed" | "cancelled"; errorText: string | null };
    };

    if (payload.task.status === "completed") {
      return;
    }

    if (payload.task.status === "failed" || payload.task.status === "cancelled") {
      throw new Error(`Background task ended unexpectedly: ${payload.task.errorText ?? payload.task.status}`);
    }

    await sleep(250);
  }

  throw new Error(`Background task did not complete in non-blocking check: ${taskId}`);
}

async function waitTaskRunning(baseUrl: string, taskId: string): Promise<void> {
  for (let attempts = 0; attempts < 40; attempts++) {
    const response = await fetch(`${baseUrl}/api/background/${taskId}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Background poll failed during running check: ${response.status}`);
    }

    const payload = (await response.json()) as {
      task: { status: "pending" | "running" | "completed" | "failed" | "cancelled"; errorText: string | null };
    };

    if (payload.task.status === "running") {
      return;
    }

    if (payload.task.status === "failed" || payload.task.status === "cancelled") {
      throw new Error(`Background task failed before running check: ${payload.task.errorText ?? payload.task.status}`);
    }

    await sleep(100);
  }

  throw new Error(`Background task did not reach running state: ${taskId}`);
}

export async function assertChatRemainsUsableWhileBackgroundRuns(
  baseUrl: string,
  threadId: string,
): Promise<void> {
  const startBackground = await fetch(`${baseUrl}/api/background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId,
      agent: "researcher",
      prompt: "Return NON_BLOCKING_BACKGROUND_OK only.",
      title: "non-blocking verification",
    }),
  });

  if (!startBackground.ok) {
    throw new Error(`Failed to start background task for non-blocking check: ${startBackground.status}`);
  }

  const startedPayload = (await startBackground.json()) as BackgroundStartPayload;

  await waitTaskRunning(baseUrl, startedPayload.task.taskId);

  const chatResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: threadId,
      messages: [
        {
          id: "msg_live_non_blocking",
          role: "user",
          parts: [{ type: "text", text: "Reply with NON_BLOCKING_CHAT_OK." }],
        },
      ],
    }),
  });

  if (!chatResponse.ok) {
    throw new Error(`Chat request failed while background task was running: ${chatResponse.status}`);
  }

  await waitTaskDone(baseUrl, startedPayload.task.taskId);
}
