// Reference notes from oh-my-openagent:
// - src/tools/task/todo-sync.ts
// - src/features/background-agent/manager.ts
// - src/hooks/preemptive-compaction.ts
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { LanguageModelUsage, UIMessage } from "ai";

import { ensureDatabaseInitialized } from "@/lib/db/bootstrap";
import { db } from "@/lib/db/client";
import {
  agentRuns,
  backgroundTasks,
  compactions,
  messages,
  reminders,
  runSteps,
  threads,
  todos,
  usageSnapshots,
} from "@/lib/db/schema";
import { createId } from "@/lib/ids";
import { parseJson, stringifyJson } from "@/lib/json";
import type {
  BackgroundTaskStatus,
  JsonValue,
  ReminderStatus,
  ReminderType,
  RunMode,
  RunStatus,
  TodoPriority,
  TodoStatus,
  TokenUsage,
} from "@/lib/types";
import { normalizeUsage } from "@/lib/types";

function now(): number {
  return Date.now();
}

function messagePlainText(message: UIMessage): string {
  const chunks: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      chunks.push(part.text);
      continue;
    }
    if (part.type === "reasoning") {
      chunks.push(part.text);
      continue;
    }
    if (part.type === "dynamic-tool") {
      const state = "state" in part ? String(part.state) : "unknown";
      chunks.push(`[tool:${part.toolName}:${state}]`);
      continue;
    }
    if (part.type.startsWith("tool-")) {
      const toolName = part.type.replace(/^tool-/, "");
      const state = "state" in part ? String(part.state) : "unknown";
      chunks.push(`[tool:${toolName}:${state}]`);
      continue;
    }
  }

  return chunks.join("\n").trim();
}

function approximateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  return Math.ceil(text.length / 4);
}

export async function ensureThread(threadId: string, title?: string): Promise<void> {
  ensureDatabaseInitialized();

  const ts = now();

  await db
    .insert(threads)
    .values({
      id: threadId,
      title: title ?? "Untitled Thread",
      createdAt: ts,
      updatedAt: ts,
      lastActivityAt: ts,
    })
    .onConflictDoUpdate({
      target: threads.id,
      set: {
        ...(title ? { title } : {}),
        updatedAt: ts,
        lastActivityAt: ts,
      },
    });
}

export async function createThread(title?: string): Promise<{ id: string; title: string }> {
  ensureDatabaseInitialized();

  const ts = now();
  const id = createId("thread");

  await db.insert(threads).values({
    id,
    title: title ?? "New Thread",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });

  return { id, title: title ?? "New Thread" };
}

export async function listThreads(): Promise<
  Array<{ id: string; title: string; updatedAt: number; lastActivityAt: number }>
> {
  ensureDatabaseInitialized();

  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      updatedAt: threads.updatedAt,
      lastActivityAt: threads.lastActivityAt,
    })
    .from(threads)
    .orderBy(desc(threads.lastActivityAt));

  return rows;
}

export async function getThread(threadId: string): Promise<{
  id: string;
  title: string;
  updatedAt: number;
  lastActivityAt: number;
} | null> {
  ensureDatabaseInitialized();

  const [row] = await db
    .select({
      id: threads.id,
      title: threads.title,
      updatedAt: threads.updatedAt,
      lastActivityAt: threads.lastActivityAt,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);

  return row ?? null;
}

export async function loadThreadMessages(threadId: string): Promise<UIMessage[]> {
  ensureDatabaseInitialized();

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      partsJson: messages.partsJson,
      metadataJson: messages.metadataJson,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt));

  return rows.map((row) => {
    const parsed = parseJson<Array<UIMessage["parts"][number]>>(row.partsJson, []);
    const metadata = parseJson<Record<string, unknown> | undefined>(
      row.metadataJson,
      undefined,
    );

    const message: UIMessage = {
      id: row.id,
      role: row.role as UIMessage["role"],
      parts: parsed,
      ...(metadata ? { metadata } : {}),
    };

    return message;
  });
}

export async function appendSystemMessage(
  threadId: string,
  text: string,
  metadata?: Record<string, unknown>,
): Promise<UIMessage> {
  ensureDatabaseInitialized();
  await ensureThread(threadId);

  const ts = now();
  const message: UIMessage = {
    id: createId("msg"),
    role: "system",
    parts: [{ type: "text", text }],
    ...(metadata ? { metadata } : {}),
  };

  await db.insert(messages).values({
    id: message.id,
    threadId,
    role: message.role,
    plainText: text,
    partsJson: stringifyJson(message.parts),
    metadataJson: metadata ? stringifyJson(metadata) : null,
    createdAt: ts,
  });

  await db
    .update(threads)
    .set({ updatedAt: ts, lastActivityAt: ts })
    .where(eq(threads.id, threadId));

  return message;
}

export async function persistThreadMessages(args: {
  threadId: string;
  allMessages: UIMessage[];
  usage?: LanguageModelUsage;
  usageMessageId?: string;
  model?: string;
}): Promise<void> {
  ensureDatabaseInitialized();

  const { threadId, allMessages, usage, usageMessageId, model } = args;
  const ts = now();
  const normalizedUsage = normalizeUsage(usage);

  await ensureThread(threadId);

  for (let index = 0; index < allMessages.length; index++) {
    const message = allMessages[index];
    const createdAt = ts + index;

    const plainText = messagePlainText(message);
    const messageUsage: TokenUsage =
      usageMessageId && message.id === usageMessageId
        ? normalizedUsage
        : {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: approximateTokens(plainText),
            reasoningTokens: 0,
          };

    await db
      .insert(messages)
      .values({
        id: message.id,
        threadId,
        role: message.role,
        plainText,
        partsJson: stringifyJson(message.parts),
        metadataJson: message.metadata ? stringifyJson(message.metadata) : null,
        model: model ?? null,
        promptTokens: messageUsage.promptTokens,
        completionTokens: messageUsage.completionTokens,
        totalTokens: messageUsage.totalTokens,
        reasoningTokens: messageUsage.reasoningTokens,
        createdAt,
      })
      .onConflictDoUpdate({
        target: messages.id,
        set: {
          role: message.role,
          plainText,
          partsJson: stringifyJson(message.parts),
          metadataJson: message.metadata ? stringifyJson(message.metadata) : null,
          model: model ?? null,
          promptTokens: messageUsage.promptTokens,
          completionTokens: messageUsage.completionTokens,
          totalTokens: messageUsage.totalTokens,
          reasoningTokens: messageUsage.reasoningTokens,
        },
      });
  }

  await db
    .update(threads)
    .set({ updatedAt: ts, lastActivityAt: ts })
    .where(eq(threads.id, threadId));

  if (usageMessageId && usage && model) {
    await db.insert(usageSnapshots).values({
      id: createId("usage"),
      threadId,
      runId: null,
      model,
      promptTokens: normalizedUsage.promptTokens,
      completionTokens: normalizedUsage.completionTokens,
      totalTokens: normalizedUsage.totalTokens,
      reasoningTokens: normalizedUsage.reasoningTokens,
      createdAt: ts,
    });
  }
}

export async function getThreadUsage(threadId: string): Promise<TokenUsage> {
  ensureDatabaseInitialized();

  const [row] = await db
    .select({
      promptTokens: sql<number>`coalesce(sum(${messages.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${messages.completionTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${messages.totalTokens}), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(${messages.reasoningTokens}), 0)`,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId));

  return {
    promptTokens: row?.promptTokens ?? 0,
    completionTokens: row?.completionTokens ?? 0,
    totalTokens: row?.totalTokens ?? 0,
    reasoningTokens: row?.reasoningTokens ?? 0,
  };
}

export async function createRun(args: {
  threadId: string;
  mode: RunMode;
  agent: string;
  title: string;
  parentRunId?: string;
  model?: string;
}): Promise<string> {
  ensureDatabaseInitialized();

  const id = createId("run");
  const ts = now();

  await db.insert(agentRuns).values({
    id,
    threadId: args.threadId,
    parentRunId: args.parentRunId ?? null,
    mode: args.mode,
    agent: args.agent,
    title: args.title,
    status: "queued",
    model: args.model ?? null,
    createdAt: ts,
    updatedAt: ts,
    finishedAt: null,
    errorText: null,
  });

  return id;
}

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  errorText?: string,
): Promise<void> {
  ensureDatabaseInitialized();

  const ts = now();
  await db
    .update(agentRuns)
    .set({
      status,
      errorText: errorText ?? null,
      updatedAt: ts,
      finishedAt: status === "completed" || status === "failed" ? ts : null,
    })
    .where(eq(agentRuns.id, runId));
}

export async function addRunStep(args: {
  runId: string;
  threadId: string;
  stepType: string;
  content: JsonValue;
}): Promise<void> {
  ensureDatabaseInitialized();

  await db.insert(runSteps).values({
    id: createId("step"),
    runId: args.runId,
    threadId: args.threadId,
    stepType: args.stepType,
    contentJson: stringifyJson(args.content),
    createdAt: now(),
  });
}

export async function listRunSteps(runId: string): Promise<Array<{
  id: string;
  stepType: string;
  content: JsonValue;
  createdAt: number;
}>> {
  ensureDatabaseInitialized();

  const rows = await db
    .select({
      id: runSteps.id,
      stepType: runSteps.stepType,
      contentJson: runSteps.contentJson,
      createdAt: runSteps.createdAt,
    })
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.createdAt));

  return rows.map((row) => ({
    id: row.id,
    stepType: row.stepType,
    content: parseJson<JsonValue>(row.contentJson, null),
    createdAt: row.createdAt,
  }));
}

export async function createBackgroundTask(args: {
  threadId: string;
  runId?: string;
  taskType: string;
  agent: string;
  input: JsonValue;
  triggerRunId?: string;
}): Promise<string> {
  ensureDatabaseInitialized();

  const id = createId("bg");
  const ts = now();

  await db.insert(backgroundTasks).values({
    id,
    threadId: args.threadId,
    runId: args.runId ?? null,
    taskType: args.taskType,
    agent: args.agent,
    status: "pending",
    progress: 0,
    inputJson: stringifyJson(args.input),
    outputJson: null,
    errorText: null,
    triggerRunId: args.triggerRunId ?? null,
    createdAt: ts,
    updatedAt: ts,
    startedAt: null,
    finishedAt: null,
  });

  return id;
}

export async function updateBackgroundTask(args: {
  taskId: string;
  status?: BackgroundTaskStatus;
  progress?: number;
  output?: JsonValue;
  errorText?: string;
  triggerRunId?: string;
}): Promise<void> {
  ensureDatabaseInitialized();

  const ts = now();

  const [current] = await db
    .select({
      status: backgroundTasks.status,
    })
    .from(backgroundTasks)
    .where(eq(backgroundTasks.id, args.taskId))
    .limit(1);

  if (!current) {
    return;
  }

  const nextStatus = args.status ?? (current.status as BackgroundTaskStatus);

  await db
    .update(backgroundTasks)
    .set({
      status: nextStatus,
      progress: args.progress ?? undefined,
      outputJson: args.output ? stringifyJson(args.output) : undefined,
      errorText: args.errorText ?? undefined,
      triggerRunId: args.triggerRunId,
      updatedAt: ts,
      startedAt: nextStatus === "running" ? ts : undefined,
      finishedAt:
        nextStatus === "completed" || nextStatus === "failed" || nextStatus === "cancelled"
          ? ts
          : undefined,
    })
    .where(eq(backgroundTasks.id, args.taskId));
}

export async function getBackgroundTask(taskId: string): Promise<{
  id: string;
  threadId: string;
  runId: string | null;
  taskType: string;
  agent: string;
  status: BackgroundTaskStatus;
  progress: number;
  input: JsonValue;
  output: JsonValue;
  errorText: string | null;
  triggerRunId: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
} | null> {
  ensureDatabaseInitialized();

  const [row] = await db
    .select()
    .from(backgroundTasks)
    .where(eq(backgroundTasks.id, taskId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    threadId: row.threadId,
    runId: row.runId,
    taskType: row.taskType,
    agent: row.agent,
    status: row.status as BackgroundTaskStatus,
    progress: row.progress,
    input: parseJson<JsonValue>(row.inputJson, null),
    output: parseJson<JsonValue>(row.outputJson, null),
    errorText: row.errorText,
    triggerRunId: row.triggerRunId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function listBackgroundTasks(threadId: string): Promise<Array<{
  id: string;
  status: BackgroundTaskStatus;
  taskType: string;
  agent: string;
  progress: number;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}>> {
  ensureDatabaseInitialized();

  const rows = await db
    .select({
      id: backgroundTasks.id,
      status: backgroundTasks.status,
      taskType: backgroundTasks.taskType,
      agent: backgroundTasks.agent,
      progress: backgroundTasks.progress,
      createdAt: backgroundTasks.createdAt,
      updatedAt: backgroundTasks.updatedAt,
      finishedAt: backgroundTasks.finishedAt,
    })
    .from(backgroundTasks)
    .where(eq(backgroundTasks.threadId, threadId))
    .orderBy(desc(backgroundTasks.createdAt));

  return rows.map((row) => ({
    ...row,
    status: row.status as BackgroundTaskStatus,
  }));
}

export async function createTodo(args: {
  threadId: string;
  content: string;
  priority?: TodoPriority;
  sourceBackgroundTaskId?: string;
}): Promise<{ id: string }> {
  ensureDatabaseInitialized();

  const id = createId("todo");
  const ts = now();

  await db.insert(todos).values({
    id,
    threadId: args.threadId,
    content: args.content,
    status: "pending",
    priority: args.priority ?? "medium",
    sourceBackgroundTaskId: args.sourceBackgroundTaskId ?? null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
  });

  return { id };
}

export async function updateTodo(args: {
  todoId: string;
  content?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
}): Promise<void> {
  ensureDatabaseInitialized();

  const ts = now();

  await db
    .update(todos)
    .set({
      content: args.content,
      status: args.status,
      priority: args.priority,
      updatedAt: ts,
      completedAt: args.status === "completed" ? ts : undefined,
    })
    .where(eq(todos.id, args.todoId));
}

export async function listTodos(threadId: string): Promise<Array<{
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: number;
  updatedAt: number;
}>> {
  ensureDatabaseInitialized();

  const rows = await db
    .select({
      id: todos.id,
      content: todos.content,
      status: todos.status,
      priority: todos.priority,
      createdAt: todos.createdAt,
      updatedAt: todos.updatedAt,
    })
    .from(todos)
    .where(eq(todos.threadId, threadId))
    .orderBy(desc(todos.createdAt));

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    status: row.status as TodoStatus,
    priority: row.priority as TodoPriority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listIncompleteTodos(threadId: string): Promise<Array<{
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}>> {
  ensureDatabaseInitialized();

  const rows = await db
    .select({
      id: todos.id,
      content: todos.content,
      status: todos.status,
      priority: todos.priority,
    })
    .from(todos)
    .where(
      and(
        eq(todos.threadId, threadId),
        inArray(todos.status, ["pending", "in_progress"]),
      ),
    )
    .orderBy(desc(todos.createdAt));

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    status: row.status as TodoStatus,
    priority: row.priority as TodoPriority,
  }));
}

export async function createReminder(args: {
  threadId: string;
  reminderType: ReminderType;
  triggerAt: number;
  payload: JsonValue;
  targetBackgroundTaskId?: string;
}): Promise<string> {
  ensureDatabaseInitialized();

  const id = createId("rem");
  const ts = now();

  await db.insert(reminders).values({
    id,
    threadId: args.threadId,
    reminderType: args.reminderType,
    status: "scheduled",
    targetBackgroundTaskId: args.targetBackgroundTaskId ?? null,
    payloadJson: stringifyJson(args.payload),
    triggerAt: args.triggerAt,
    sentAt: null,
    createdAt: ts,
    updatedAt: ts,
  });

  return id;
}

export async function listDueReminders(): Promise<Array<{
  id: string;
  threadId: string;
  reminderType: ReminderType;
  payload: JsonValue;
  triggerAt: number;
  targetBackgroundTaskId: string | null;
}>> {
  ensureDatabaseInitialized();

  const rows = await db
    .select({
      id: reminders.id,
      threadId: reminders.threadId,
      reminderType: reminders.reminderType,
      payloadJson: reminders.payloadJson,
      triggerAt: reminders.triggerAt,
      targetBackgroundTaskId: reminders.targetBackgroundTaskId,
    })
    .from(reminders)
    .where(and(eq(reminders.status, "scheduled"), lte(reminders.triggerAt, now())))
    .orderBy(asc(reminders.triggerAt));

  return rows.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    reminderType: row.reminderType as ReminderType,
    payload: parseJson<JsonValue>(row.payloadJson, null),
    triggerAt: row.triggerAt,
    targetBackgroundTaskId: row.targetBackgroundTaskId,
  }));
}

export async function hasScheduledReminder(
  threadId: string,
  reminderType: ReminderType,
): Promise<boolean> {
  ensureDatabaseInitialized();

  const [row] = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(
      and(
        eq(reminders.threadId, threadId),
        eq(reminders.reminderType, reminderType),
        eq(reminders.status, "scheduled"),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function hasRecentReminderMessage(
  threadId: string,
  reminderType: ReminderType,
  withinMs: number,
): Promise<boolean> {
  ensureDatabaseInitialized();

  const since = now() - withinMs;

  const rows = await db
    .select({ metadataJson: messages.metadataJson })
    .from(messages)
    .where(
      and(
        eq(messages.threadId, threadId),
        eq(messages.role, "system"),
        lte(sql`${since}`, messages.createdAt),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(20);

  return rows.some((row) => {
    const metadata = parseJson<Record<string, unknown> | undefined>(
      row.metadataJson,
      undefined,
    );
    return metadata?.reminderType === reminderType;
  });
}

export async function markReminderStatus(
  reminderId: string,
  status: ReminderStatus,
): Promise<void> {
  ensureDatabaseInitialized();

  const ts = now();
  await db
    .update(reminders)
    .set({
      status,
      sentAt: status === "sent" ? ts : undefined,
      updatedAt: ts,
    })
    .where(eq(reminders.id, reminderId));
}

export async function getLatestCompaction(threadId: string): Promise<{
  id: string;
  summary: string;
  compactedUntilMessageId: string | null;
  tokenBudget: number;
  compactedTokenCount: number;
  createdAt: number;
} | null> {
  ensureDatabaseInitialized();

  const [row] = await db
    .select({
      id: compactions.id,
      summary: compactions.summary,
      compactedUntilMessageId: compactions.compactedUntilMessageId,
      tokenBudget: compactions.tokenBudget,
      compactedTokenCount: compactions.compactedTokenCount,
      createdAt: compactions.createdAt,
    })
    .from(compactions)
    .where(eq(compactions.threadId, threadId))
    .orderBy(desc(compactions.createdAt))
    .limit(1);

  return row ?? null;
}

export async function createCompaction(args: {
  threadId: string;
  summary: string;
  compactedUntilMessageId?: string;
  tokenBudget: number;
  compactedTokenCount: number;
  compactedMessageIds: string[];
}): Promise<string> {
  ensureDatabaseInitialized();

  const id = createId("cmp");
  const ts = now();

  await db.insert(compactions).values({
    id,
    threadId: args.threadId,
    summary: args.summary,
    compactedUntilMessageId: args.compactedUntilMessageId ?? null,
    tokenBudget: args.tokenBudget,
    compactedTokenCount: args.compactedTokenCount,
    createdAt: ts,
  });

  if (args.compactedMessageIds.length > 0) {
    await db
      .update(messages)
      .set({ compactedAt: ts })
      .where(
        and(
          eq(messages.threadId, args.threadId),
          inArray(messages.id, args.compactedMessageIds),
          isNull(messages.compactedAt),
        ),
      );
  }

  return id;
}

export async function listCompactionCandidates(threadId: string): Promise<Array<{
  id: string;
  role: string;
  parts: UIMessage["parts"];
  plainText: string;
  totalTokens: number;
  createdAt: number;
}>> {
  ensureDatabaseInitialized();

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      partsJson: messages.partsJson,
      plainText: messages.plainText,
      totalTokens: messages.totalTokens,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), isNull(messages.compactedAt)))
    .orderBy(asc(messages.createdAt));

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: parseJson<UIMessage["parts"]>(row.partsJson, []),
    plainText: row.plainText,
    totalTokens: row.totalTokens,
    createdAt: row.createdAt,
  }));
}
