import { NextResponse } from "next/server";
import { z } from "zod";

import { createBackgroundCompletionReminder } from "@/lib/reminders";
import { appendSystemMessage, updateBackgroundTask, updateRunStatus } from "@/lib/store";

const callbackSchema = z.object({
  taskId: z.string(),
  runId: z.string(),
  threadId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  progress: z.number().min(0).max(100).optional(),
  output: z.unknown().optional(),
  errorText: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const expectedSecret = process.env.BACKGROUND_CALLBACK_SECRET;
  if (expectedSecret) {
    const providedSecret = request.headers.get("x-webhook-secret");
    if (providedSecret !== expectedSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const payload = parsed.data;

  await updateBackgroundTask({
    taskId: payload.taskId,
    status: payload.status,
    progress: payload.progress,
    output: payload.output as never,
    errorText: payload.errorText,
  });

  if (payload.status === "running") {
    await updateRunStatus(payload.runId, "background");
  }

  if (payload.status === "completed") {
    await updateRunStatus(payload.runId, "completed");
    await appendSystemMessage(
      payload.threadId,
      `Background task ${payload.taskId} completed (Trigger.dev).`,
      {
        reminderType: "background_done",
        taskId: payload.taskId,
        source: "trigger",
      },
    );
    await createBackgroundCompletionReminder({
      threadId: payload.threadId,
      backgroundTaskId: payload.taskId,
      description: "Trigger.dev background delegation",
    });
  }

  if (payload.status === "failed") {
    await updateRunStatus(payload.runId, "failed", payload.errorText);
    await appendSystemMessage(
      payload.threadId,
      `Background task ${payload.taskId} failed (Trigger.dev): ${payload.errorText ?? "Unknown error"}`,
      {
        reminderType: "background_done",
        taskId: payload.taskId,
        source: "trigger",
      },
    );
  }

  return NextResponse.json({ ok: true });
}
