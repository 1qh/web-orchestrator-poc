import { NextResponse } from "next/server";

import {
  getThread,
  getThreadUsage,
  listBackgroundTasks,
  listTodos,
  loadThreadMessages,
} from "@/lib/store";
import {
  ensureUnfinishedTodoContinuationReminder,
  processDueReminders,
} from "@/lib/reminders";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ threadId: string }> },
): Promise<NextResponse> {
  const { threadId } = await context.params;

  const thread = await getThread(threadId);
  if (!thread) {
    return NextResponse.json(
      {
        error: "thread_not_found",
      },
      { status: 404 },
    );
  }

  await processDueReminders();
  await ensureUnfinishedTodoContinuationReminder(threadId);

  const [messages, todos, backgroundTasks, usage] = await Promise.all([
    loadThreadMessages(threadId),
    listTodos(threadId),
    listBackgroundTasks(threadId),
    getThreadUsage(threadId),
  ]);

  return NextResponse.json({
    thread,
    messages,
    todos,
    backgroundTasks,
    usage,
  });
}
