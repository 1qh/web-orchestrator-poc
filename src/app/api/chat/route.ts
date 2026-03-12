import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { maybeCompactContext } from "@/lib/compaction";
import { DEFAULT_MODEL } from "@/lib/config";
import {
  addRunStep,
  createRun,
  ensureThread,
  loadThreadMessages,
  persistThreadMessages,
  updateRunStatus,
} from "@/lib/store";
import {
  delegateToolInputSchema,
  runDelegationTool,
} from "@/lib/tools/delegation";
import { listMcpServerTools, listMcpServers, runMcpTool } from "@/lib/tools/mcp";
import { runGroundedSearch } from "@/lib/tools/search";
import { runTodoTool, todoToolInputSchema } from "@/lib/tools/todos";
import {
  ensureUnfinishedTodoContinuationReminder,
  processDueReminders,
} from "@/lib/reminders";
import { normalizeUsage, type JsonValue } from "@/lib/types";

const requestSchema = z.object({
  id: z.string(),
  message: z.custom<UIMessage>().optional(),
  messages: z.array(z.custom<UIMessage>()).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1),
});

const mcpSchema = z.object({
  action: z.enum(["list_servers", "list_tools", "call_tool"]),
  serverName: z.string().optional(),
  toolName: z.string().optional(),
  toolArgs: z.record(z.string(), z.unknown()).optional(),
});

function stripMessageIds(messages: UIMessage[]): Array<Omit<UIMessage, "id">> {
  return messages.map(({ id: _id, ...rest }) => rest);
}

function asMessageArray(input: UIMessage[] | undefined, message?: UIMessage): UIMessage[] {
  if (input && input.length > 0) {
    return input;
  }

  return message ? [message] : [];
}

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const rawBody = (await request.json().catch(() => null)) as unknown;
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const threadId = parsed.data.id;
  await ensureThread(threadId);
  await processDueReminders();
  await ensureUnfinishedTodoContinuationReminder(threadId);

  const previousMessages = await loadThreadMessages(threadId);
  const incomingMessages = asMessageArray(parsed.data.messages, parsed.data.message);
  const allMessages = [...previousMessages, ...incomingMessages];

  if (allMessages.length === 0) {
    return Response.json(
      { error: "missing_messages", detail: "No chat messages were provided." },
      { status: 400 },
    );
  }

  const runId = await createRun({
    threadId,
    mode: "sync",
    agent: "orchestrator",
    title: "Primary orchestrator run",
    model: DEFAULT_MODEL,
  });

  await updateRunStatus(runId, "running");

  const compacted = await maybeCompactContext({ threadId, messages: allMessages });

  let finalUsage: LanguageModelUsage | undefined;

  const result = streamText({
    model: google(DEFAULT_MODEL),
    messages: await convertToModelMessages(stripMessageIds(compacted.messages)),
    stopWhen: stepCountIs(8),
    onStepFinish: async (event) => {
      await addRunStep({
        runId,
        threadId,
        stepType: "step_finish",
        content: {
          finishReason: event.finishReason,
          usage: normalizeUsage(event.usage),
          text: event.text,
          toolCalls: event.toolCalls.map((call) => ({
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            input: toJsonValue(call.input),
          })),
        },
      });
    },
    onFinish: async (event) => {
      finalUsage = event.totalUsage;
      await addRunStep({
        runId,
        threadId,
        stepType: "run_finish",
        content: {
          finishReason: event.finishReason,
          usage: normalizeUsage(event.totalUsage),
        },
      });
      await updateRunStatus(runId, "completed");
    },
    onError: async ({ error }) => {
      const message = error instanceof Error ? error.message : String(error);
      await updateRunStatus(runId, "failed", message);
      await addRunStep({
        runId,
        threadId,
        stepType: "error",
        content: { message },
      });
    },
    tools: {
      search: tool({
        description: "Grounded web search using Gemini search grounding.",
        inputSchema: searchSchema,
        execute: async ({ query }) => runGroundedSearch(query),
      }),
      todo: tool({
        description: "Manage todo items in the active thread.",
        inputSchema: todoToolInputSchema,
        execute: runTodoTool,
      }),
      delegate: tool({
        description:
          "Delegate a task to specialized agent modes. Supports sync, background, and parallel execution.",
        inputSchema: delegateToolInputSchema,
        execute: runDelegationTool,
      }),
      mcp: tool({
        description: "Use configured MCP servers to list tools or call tools.",
        inputSchema: mcpSchema,
        execute: async (input) => {
          if (input.action === "list_servers") {
            return { servers: listMcpServers() };
          }

          if (input.action === "list_tools") {
            if (!input.serverName) {
              throw new Error("serverName is required for action=list_tools");
            }

            return listMcpServerTools(input.serverName);
          }

          if (!input.serverName || !input.toolName) {
            throw new Error("serverName and toolName are required for action=call_tool");
          }

          return runMcpTool({
            serverName: input.serverName,
            toolName: input.toolName,
            toolArgs: input.toolArgs,
          });
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: allMessages,
    sendReasoning: true,
    sendSources: true,
    onFinish: async ({ messages, responseMessage, isAborted }) => {
      await persistThreadMessages({
        threadId,
        allMessages: messages,
        usage: finalUsage,
        usageMessageId: responseMessage.id,
        model: DEFAULT_MODEL,
      });

      if (isAborted) {
        await updateRunStatus(runId, "cancelled");
      }

      await ensureUnfinishedTodoContinuationReminder(threadId);
      await processDueReminders();
    },
  });
}
