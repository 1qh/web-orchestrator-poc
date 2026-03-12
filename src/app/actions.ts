"use server";

import {
  createThread,
  listBackgroundTasks,
  listThreads,
  listTodos,
  updateTodo,
} from "@/lib/store";
import { startBackgroundDelegation } from "@/lib/background/runner";
import { processDueReminders } from "@/lib/reminders";

export async function createThreadAction(title?: string): Promise<{ id: string; title: string }> {
  return createThread(title);
}

export async function listThreadsAction(): Promise<
  Array<{ id: string; title: string; updatedAt: number; lastActivityAt: number }>
> {
  return listThreads();
}

export async function updateTodoAction(args: {
  todoId: string;
  content?: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "low" | "medium" | "high";
}): Promise<void> {
  await updateTodo(args);
}

export async function startBackgroundDelegationAction(args: {
  threadId: string;
  agent: string;
  prompt: string;
  title: string;
}): Promise<{ taskId: string; runId: string; transport: "trigger" | "local" }> {
  return startBackgroundDelegation(args);
}

export async function getThreadWorkStateAction(threadId: string): Promise<{
  todos: Awaited<ReturnType<typeof listTodos>>;
  backgroundTasks: Awaited<ReturnType<typeof listBackgroundTasks>>;
}> {
  await processDueReminders();
  const [todos, backgroundTasks] = await Promise.all([
    listTodos(threadId),
    listBackgroundTasks(threadId),
  ]);
  return { todos, backgroundTasks };
}
