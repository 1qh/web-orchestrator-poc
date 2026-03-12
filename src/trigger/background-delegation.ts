import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { task } from "@trigger.dev/sdk/v3";

import { getAgentInstruction } from "@/lib/agents";
import { DEFAULT_MODEL } from "@/lib/config";

async function sendCallback(args: {
  callbackUrl: string;
  callbackSecret?: string;
  taskId: string;
  runId: string;
  threadId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  output?: unknown;
  errorText?: string;
}): Promise<void> {
  await fetch(args.callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(args.callbackSecret
        ? {
            "x-webhook-secret": args.callbackSecret,
          }
        : {}),
    },
    body: JSON.stringify({
      taskId: args.taskId,
      runId: args.runId,
      threadId: args.threadId,
      status: args.status,
      progress: args.progress,
      output: args.output,
      errorText: args.errorText,
    }),
  });
}

export const backgroundDelegationTask = task({
  id: "background-delegation",
  run: async (payload: {
    taskId: string;
    runId: string;
    threadId: string;
    agent: string;
    prompt: string;
    callbackUrl: string;
    callbackSecret?: string;
  }) => {
    await sendCallback({
      callbackUrl: payload.callbackUrl,
      callbackSecret: payload.callbackSecret,
      taskId: payload.taskId,
      runId: payload.runId,
      threadId: payload.threadId,
      status: "running",
      progress: 15,
    });

    try {
      const result = await generateText({
        model: google(DEFAULT_MODEL),
        system: getAgentInstruction(payload.agent),
        prompt: payload.prompt,
      });

      await sendCallback({
        callbackUrl: payload.callbackUrl,
        callbackSecret: payload.callbackSecret,
        taskId: payload.taskId,
        runId: payload.runId,
        threadId: payload.threadId,
        status: "completed",
        progress: 100,
        output: {
          text: result.text,
        },
      });

      return {
        text: result.text,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sendCallback({
        callbackUrl: payload.callbackUrl,
        callbackSecret: payload.callbackSecret,
        taskId: payload.taskId,
        runId: payload.runId,
        threadId: payload.threadId,
        status: "failed",
        progress: 100,
        errorText: message,
      });
      throw error;
    }
  },
});
