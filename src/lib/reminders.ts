// Reference notes from oh-my-openagent:
// - src/hooks/todo-continuation-enforcer/continuation-injection.ts
// - src/features/background-agent/background-task-notification-template.ts
import { UNFINISHED_TODO_REMINDER_MINUTES } from "@/lib/config";
import {
  appendSystemMessage,
  createReminder,
  hasRecentReminderMessage,
  hasScheduledReminder,
  listDueReminders,
  listIncompleteTodos,
  markReminderStatus,
} from "@/lib/store";

function now(): number {
  return Date.now();
}

export async function ensureUnfinishedTodoContinuationReminder(
  threadId: string,
): Promise<void> {
  const incomplete = await listIncompleteTodos(threadId);
  if (incomplete.length === 0) {
    return;
  }

  const hasRecent = await hasRecentReminderMessage(threadId, "unfinished_todos", 5 * 60 * 1000);
  if (!hasRecent) {
    await appendSystemMessage(
      threadId,
      `You have ${incomplete.length} unfinished todo item(s). Continue from where you left off.`,
      {
        reminderType: "unfinished_todos",
        incompleteTodos: incomplete.map((todo) => ({
          id: todo.id,
          content: todo.content,
          status: todo.status,
          priority: todo.priority,
        })),
      },
    );
  }

  const alreadyScheduled = await hasScheduledReminder(threadId, "unfinished_todos");
  if (!alreadyScheduled) {
    const triggerAt = now() + UNFINISHED_TODO_REMINDER_MINUTES * 60 * 1000;
    await createReminder({
      threadId,
      reminderType: "unfinished_todos",
      triggerAt,
      payload: {
        message: `You still have ${incomplete.length} unfinished todo item(s).`,
      },
    });
  }
}

export async function createBackgroundCompletionReminder(args: {
  threadId: string;
  backgroundTaskId: string;
  description: string;
}): Promise<void> {
  await createReminder({
    threadId: args.threadId,
    reminderType: "background_done",
    triggerAt: now(),
    targetBackgroundTaskId: args.backgroundTaskId,
    payload: {
      message: `Background task completed: ${args.description}`,
      taskId: args.backgroundTaskId,
    },
  });
}

export async function processDueReminders(): Promise<number> {
  const due = await listDueReminders();
  let sent = 0;

  for (const reminder of due) {
    const payload =
      typeof reminder.payload === "object" && reminder.payload
        ? (reminder.payload as Record<string, unknown>)
        : {};

    const message =
      typeof payload.message === "string"
        ? payload.message
        : reminder.reminderType === "unfinished_todos"
          ? "You have unfinished todos pending."
          : "A background task has completed.";

    await appendSystemMessage(reminder.threadId, message, {
      reminderType: reminder.reminderType,
      reminderId: reminder.id,
      targetBackgroundTaskId: reminder.targetBackgroundTaskId,
      payload,
    });

    await markReminderStatus(reminder.id, "sent");
    sent += 1;
  }

  return sent;
}
