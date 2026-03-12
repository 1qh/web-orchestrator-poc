import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastActivityAt: integer("last_activity_at").notNull(),
  },
  (table) => ({
    lastActivityIdx: index("threads_last_activity_idx").on(table.lastActivityAt),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    plainText: text("plain_text").notNull(),
    partsJson: text("parts_json").notNull(),
    metadataJson: text("metadata_json"),
    model: text("model"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    compactedAt: integer("compacted_at"),
  },
  (table) => ({
    threadTimeIdx: index("messages_thread_time_idx").on(table.threadId, table.createdAt),
    threadCompactedIdx: index("messages_thread_compacted_idx").on(
      table.threadId,
      table.compactedAt,
    ),
  }),
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    parentRunId: text("parent_run_id"),
    mode: text("mode").notNull(),
    agent: text("agent").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    model: text("model"),
    errorText: text("error_text"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => ({
    threadRunTimeIdx: index("agent_runs_thread_time_idx").on(table.threadId, table.createdAt),
    runStatusIdx: index("agent_runs_status_idx").on(table.status),
  }),
);

export const runSteps = sqliteTable(
  "run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    stepType: text("step_type").notNull(),
    contentJson: text("content_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    runStepIdx: index("run_steps_run_idx").on(table.runId, table.createdAt),
  }),
);

export const backgroundTasks = sqliteTable(
  "background_tasks",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    taskType: text("task_type").notNull(),
    agent: text("agent").notNull(),
    status: text("status").notNull(),
    progress: integer("progress").notNull().default(0),
    inputJson: text("input_json").notNull(),
    outputJson: text("output_json"),
    errorText: text("error_text"),
    triggerRunId: text("trigger_run_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
  },
  (table) => ({
    threadBgTaskTimeIdx: index("background_tasks_thread_time_idx").on(
      table.threadId,
      table.createdAt,
    ),
    bgTaskStatusIdx: index("background_tasks_status_idx").on(table.status),
  }),
);

export const todos = sqliteTable(
  "todos",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    status: text("status").notNull(),
    priority: text("priority").notNull().default("medium"),
    sourceBackgroundTaskId: text("source_background_task_id").references(
      () => backgroundTasks.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => ({
    todoThreadStatusIdx: index("todos_thread_status_idx").on(table.threadId, table.status),
  }),
);

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    reminderType: text("reminder_type").notNull(),
    status: text("status").notNull(),
    targetBackgroundTaskId: text("target_background_task_id").references(
      () => backgroundTasks.id,
      { onDelete: "set null" },
    ),
    payloadJson: text("payload_json").notNull(),
    triggerAt: integer("trigger_at").notNull(),
    sentAt: integer("sent_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    reminderThreadStatusIdx: index("reminders_thread_status_idx").on(
      table.threadId,
      table.status,
    ),
    reminderTriggerIdx: index("reminders_trigger_at_idx").on(table.triggerAt),
  }),
);

export const compactions = sqliteTable(
  "compactions",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    compactedUntilMessageId: text("compacted_until_message_id"),
    tokenBudget: integer("token_budget").notNull(),
    compactedTokenCount: integer("compacted_token_count").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    compactionThreadTimeIdx: index("compactions_thread_time_idx").on(table.threadId, table.createdAt),
  }),
);

export const usageSnapshots = sqliteTable(
  "usage_snapshots",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    reasoningTokens: integer("reasoning_tokens").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    usageThreadTimeIdx: index("usage_snapshots_thread_time_idx").on(table.threadId, table.createdAt),
  }),
);

export type ThreadRecord = InferSelectModel<typeof threads>;
export type MessageRecord = InferSelectModel<typeof messages>;
export type AgentRunRecord = InferSelectModel<typeof agentRuns>;
export type RunStepRecord = InferSelectModel<typeof runSteps>;
export type BackgroundTaskRecord = InferSelectModel<typeof backgroundTasks>;
export type TodoRecord = InferSelectModel<typeof todos>;
export type ReminderRecord = InferSelectModel<typeof reminders>;
export type CompactionRecord = InferSelectModel<typeof compactions>;
export type UsageSnapshotRecord = InferSelectModel<typeof usageSnapshots>;

export type NewThreadRecord = InferInsertModel<typeof threads>;
export type NewMessageRecord = InferInsertModel<typeof messages>;
export type NewAgentRunRecord = InferInsertModel<typeof agentRuns>;
export type NewRunStepRecord = InferInsertModel<typeof runSteps>;
export type NewBackgroundTaskRecord = InferInsertModel<typeof backgroundTasks>;
export type NewTodoRecord = InferInsertModel<typeof todos>;
export type NewReminderRecord = InferInsertModel<typeof reminders>;
export type NewCompactionRecord = InferInsertModel<typeof compactions>;
export type NewUsageSnapshotRecord = InferInsertModel<typeof usageSnapshots>;
