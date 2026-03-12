import type { LanguageModelUsage, UIMessage } from "ai";

export const TODO_STATUS = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export const TODO_PRIORITY = ["low", "medium", "high"] as const;

export const RUN_STATUS = [
  "queued",
  "running",
  "waiting_tool",
  "background",
  "completed",
  "failed",
  "cancelled",
] as const;

export const RUN_MODE = ["sync", "async", "background"] as const;

export const BACKGROUND_TASK_STATUS = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const REMINDER_TYPE = ["unfinished_todos", "background_done"] as const;

export const REMINDER_STATUS = ["scheduled", "sent", "cancelled"] as const;

export type TodoStatus = (typeof TODO_STATUS)[number];
export type TodoPriority = (typeof TODO_PRIORITY)[number];
export type RunStatus = (typeof RUN_STATUS)[number];
export type RunMode = (typeof RUN_MODE)[number];
export type BackgroundTaskStatus = (typeof BACKGROUND_TASK_STATUS)[number];
export type ReminderType = (typeof REMINDER_TYPE)[number];
export type ReminderStatus = (typeof REMINDER_STATUS)[number];

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export type PersistedUIMessage = UIMessage & {
  createdAt?: Date;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
};

export function normalizeUsage(usage: LanguageModelUsage | undefined): TokenUsage {
  return {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
  };
}
