import { sleep } from "./server-process";

type BackgroundTaskResponse = {
  task: {
    id: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    output: unknown;
    errorText: string | null;
  };
};

export async function createThread(baseUrl: string): Promise<string> {
  const createdThread = await fetch(`${baseUrl}/api/threads`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: "live e2e thread" }),
  });

  if (!createdThread.ok) {
    throw new Error(`Failed to create thread: ${createdThread.status}`);
  }

  const createdPayload = (await createdThread.json()) as {
    thread: { id: string; title: string };
  };

  return createdPayload.thread.id;
}

export async function runChatAndAssert(baseUrl: string, threadId: string): Promise<void> {
  const chatResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: threadId,
      messages: [
        {
          id: "msg_live_user_1",
          role: "user",
          parts: [{ type: "text", text: "Reply with the token LIVE_CHAT_OK." }],
        },
      ],
    }),
  });

  if (!chatResponse.ok) {
    throw new Error(`Chat request failed: ${chatResponse.status}`);
  }

  if (chatResponse.headers.get("x-vercel-ai-ui-message-stream") !== "v1") {
    throw new Error("Chat response did not return UI message stream header");
  }

  const chatBody = await chatResponse.text();
  if (chatBody.length === 0) {
    throw new Error("Chat response stream body was empty");
  }

  if (!chatBody.includes("LIVE_CHAT_OK")) {
    throw new Error("Chat response did not include LIVE_CHAT_OK token");
  }

  const chatStateResponse = await fetch(`${baseUrl}/api/threads/${threadId}/state`, {
    cache: "no-store",
  });

  if (!chatStateResponse.ok) {
    throw new Error(`Thread state after chat failed: ${chatStateResponse.status}`);
  }

  const chatStatePayload = (await chatStateResponse.json()) as {
    messages: Array<{ role: string }>;
    usage: { totalTokens: number };
  };

  if (!chatStatePayload.messages.some((message) => message.role === "assistant")) {
    throw new Error("Thread state after chat did not include assistant message");
  }

  if (chatStatePayload.usage.totalTokens <= 0) {
    throw new Error("Thread usage did not increase after chat");
  }
}

export async function startBackgroundAndWait(
  baseUrl: string,
  threadId: string,
): Promise<string> {
  const startBackground = await fetch(`${baseUrl}/api/background`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      threadId,
      agent: "researcher",
      prompt: "Reply with BACKGROUND_LOCAL_OK only.",
      title: "live e2e background",
    }),
  });

  if (!startBackground.ok) {
    throw new Error(`Failed to start background task: ${startBackground.status}`);
  }

  const startedPayload = (await startBackground.json()) as {
    task: { taskId: string; runId: string; transport: "local" | "trigger" };
  };

  if (startedPayload.task.transport !== "local") {
    throw new Error(`Expected local transport, got ${startedPayload.task.transport}`);
  }

  let finalTask: BackgroundTaskResponse["task"] | null = null;
  for (let attempts = 0; attempts < 80; attempts++) {
    const polled = await fetch(`${baseUrl}/api/background/${startedPayload.task.taskId}`, {
      cache: "no-store",
    });

    if (!polled.ok) {
      throw new Error(`Background poll failed: ${polled.status}`);
    }

    const polledPayload = (await polled.json()) as BackgroundTaskResponse;
    if (
      polledPayload.task.status === "completed" ||
      polledPayload.task.status === "failed" ||
      polledPayload.task.status === "cancelled"
    ) {
      finalTask = polledPayload.task;
      break;
    }

    await sleep(250);
  }

  if (!finalTask) {
    throw new Error("Background task did not finish in time");
  }

  if (finalTask.status !== "completed") {
    throw new Error(`Background task failed: ${finalTask.errorText ?? "unknown error"}`);
  }

  const output = finalTask.output as { text?: string } | null;
  if (!output?.text?.includes("BACKGROUND_LOCAL_OK")) {
    throw new Error("Background output missing BACKGROUND_LOCAL_OK token");
  }

  return startedPayload.task.taskId;
}

export async function assertFinalThreadState(
  baseUrl: string,
  threadId: string,
  taskId: string,
): Promise<void> {
  const stateResponse = await fetch(`${baseUrl}/api/threads/${threadId}/state`, {
    cache: "no-store",
  });

  if (!stateResponse.ok) {
    throw new Error(`Thread state request failed: ${stateResponse.status}`);
  }

  const statePayload = (await stateResponse.json()) as {
    messages: Array<{ role: string }>;
    backgroundTasks: Array<{ id: string; status: string }>;
  };

  if (!statePayload.messages.some((message) => message.role === "assistant")) {
    throw new Error("Thread state did not include assistant messages");
  }

  if (!statePayload.backgroundTasks.some((task) => task.id === taskId && task.status === "completed")) {
    throw new Error("Thread state did not include completed background task");
  }
}
