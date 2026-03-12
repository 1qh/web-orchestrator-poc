// Reference notes from oh-my-openagent:
// - src/hooks/preemptive-compaction.ts
// - src/hooks/compaction-context-injector/hook.ts
import { google } from "@ai-sdk/google";
import { generateText, type UIMessage } from "ai";

import {
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  CONTEXT_TOKEN_BUDGET,
  DEFAULT_MODEL,
} from "@/lib/config";
import { createId } from "@/lib/ids";
import {
  createCompaction,
  getLatestCompaction,
  listCompactionCandidates,
} from "@/lib/store";

function estimateMessageTokens(message: UIMessage): number {
  const text = message.parts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => part.text)
    .join("\n");
  return Math.ceil(text.length / 4);
}

async function summarizeMessages(messagesToCompact: UIMessage[]): Promise<string> {
  const lines = messagesToCompact.map((message) => {
    const text = message.parts
      .filter((part) => part.type === "text" || part.type === "reasoning")
      .map((part) => part.text)
      .join("\n")
      .trim();

    return `${message.role.toUpperCase()}: ${text}`;
  });

  const prompt = `Summarize the following conversation context so an assistant can continue work seamlessly.

Include:
1) user goals,
2) completed actions,
3) open tasks,
4) key factual outputs/tool results.

Conversation:\n${lines.join("\n\n")}`;

  const result = await generateText({
    model: google(DEFAULT_MODEL),
    prompt,
  });

  return result.text.trim();
}

export async function maybeCompactContext(args: {
  threadId: string;
  messages: UIMessage[];
}): Promise<{ messages: UIMessage[]; compacted: boolean; summary?: string }> {
  const { threadId, messages } = args;

  const totalTokens = messages.reduce((sum, message) => {
    return sum + estimateMessageTokens(message);
  }, 0);

  const threshold = Math.floor(CONTEXT_TOKEN_BUDGET * CONTEXT_COMPACTION_TRIGGER_RATIO);
  if (totalTokens < threshold || messages.length < 12) {
    return { messages, compacted: false };
  }

  const keepTailCount = 8;
  const splitIndex = Math.max(4, messages.length - keepTailCount);
  const compacting = messages.slice(0, splitIndex);
  const tail = messages.slice(splitIndex);

  const summary = await summarizeMessages(compacting);

  const candidates = await listCompactionCandidates(threadId);
  const compactedIds = new Set(compacting.map((message) => message.id));
  const persistedCompacted = candidates
    .filter((row) => compactedIds.has(row.id))
    .map((row) => row.id);

  await createCompaction({
    threadId,
    summary,
    compactedUntilMessageId: compacting.at(-1)?.id,
    tokenBudget: CONTEXT_TOKEN_BUDGET,
    compactedTokenCount: totalTokens,
    compactedMessageIds: persistedCompacted,
  });

  const latestCompaction = await getLatestCompaction(threadId);

  const summaryMessage: UIMessage = {
    id: createId("msg"),
    role: "system",
    parts: [
      {
        type: "text",
        text: `Conversation summary for continuation:\n${latestCompaction?.summary ?? summary}`,
      },
    ],
  };

  return {
    messages: [summaryMessage, ...tail],
    compacted: true,
    summary,
  };
}
