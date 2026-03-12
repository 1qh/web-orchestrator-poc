import { beforeEach, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { resetDatabase } from "@/test-support/reset-database";
import { clearRuntimeMocks, getRuntimeMocks } from "./mock-runtime";

const mocked = getRuntimeMocks();

async function postChat(threadId: string, text: string): Promise<void> {
  const { POST: chatPost } = await import("@/app/api/chat/route");
  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: threadId,
      messages: [
        {
          id: `msg_${threadId}_incoming`,
          role: "user",
          parts: [{ type: "text", text }],
        },
      ],
    }),
  });

  expect((await chatPost(request)).status).toBe(200);
}

function seededMessages(count: number): UIMessage[] {
  const longText = "context ".repeat(900);
  return Array.from({ length: count }, (_, index) => ({
    id: `msg_seed_${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `${index}: ${longText}` }],
  }));
}

describe("orchestrator compaction and message persistence", () => {
  beforeEach(async () => {
    await resetDatabase();
    clearRuntimeMocks();
    process.env.USE_TRIGGER_DEV = "false";
  });

  it("compacts long history and injects a continuation summary", async () => {
    const { ensureThread, getLatestCompaction, persistThreadMessages } = await import("@/lib/store");

    const threadId = "thread_capabilities_compaction";
    await ensureThread(threadId, "compaction thread");
    await persistThreadMessages({
      threadId,
      allMessages: seededMessages(14),
      model: "test-model",
    });

    mocked.generateTextMock.mockResolvedValue({ text: "COMPACTED_SUMMARY" });

    await postChat(threadId, "continue");

    const compaction = await getLatestCompaction(threadId);
    expect(compaction).not.toBeNull();
    expect(compaction?.summary).toBe("COMPACTED_SUMMARY");

    const compactedInput = mocked.convertToModelMessagesMock.mock.calls.at(-1)?.[0] as
      | Array<{ role: string; parts: Array<{ type: string; text?: string }> }>
      | undefined;
    expect(compactedInput).toBeDefined();
    expect(compactedInput?.[0]?.role).toBe("system");
    expect(compactedInput?.[0]?.parts.some((part) => part.type === "text")).toBe(true);
  });

  it("persists assistant reasoning and tool-call parts from streamed response", async () => {
    const { loadThreadMessages } = await import("@/lib/store");

    const threadId = "thread_capabilities_reasoning";
    await postChat(threadId, "show reasoning and tool call");

    const messages = await loadThreadMessages(threadId);
    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant?.parts.some((part) => part.type === "reasoning")).toBe(true);
    expect(assistant?.parts.some((part) => part.type === "dynamic-tool")).toBe(true);
    expect(assistant?.parts.some((part) => part.type === "text" && part.text === "MOCK_CHAT_REPLY")).toBe(
      true,
    );
  });
});
