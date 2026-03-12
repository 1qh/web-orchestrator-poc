// Reference notes from oh-my-openagent:
// - src/tools/delegate-task/tools.ts
// - src/tools/delegate-task/background-task.ts
// - src/tools/delegate-task/sync-task.ts
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { z } from "zod";

import { getAgentInstruction } from "@/lib/agents";
import { DEFAULT_MODEL } from "@/lib/config";
import { startBackgroundDelegation } from "@/lib/background/runner";

export const delegateToolInputSchema = z.object({
  mode: z.enum(["sync", "background", "parallel_sync", "parallel_background"]),
  threadId: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  prompt: z.string().optional(),
  tasks: z
    .array(
      z.object({
        agent: z.string(),
        prompt: z.string(),
      }),
    )
    .optional(),
});

export type DelegateToolInput = z.infer<typeof delegateToolInputSchema>;

async function executeSyncDelegation(agent: string, prompt: string): Promise<string> {
  const result = await generateText({
    model: google(DEFAULT_MODEL),
    system: getAgentInstruction(agent),
    prompt,
  });

  return result.text;
}

export async function runDelegationTool(input: DelegateToolInput): Promise<unknown> {
  if (input.mode === "sync") {
    if (!input.agent || !input.prompt) {
      throw new Error("agent and prompt are required for sync mode");
    }

    const output = await executeSyncDelegation(input.agent, input.prompt);
    return {
      mode: "sync",
      agent: input.agent,
      output,
    };
  }

  if (input.mode === "background") {
    if (!input.agent || !input.prompt) {
      throw new Error("agent and prompt are required for background mode");
    }

    const task = await startBackgroundDelegation({
      threadId: input.threadId,
      agent: input.agent,
      prompt: input.prompt,
      title: input.description ?? `Background delegation: ${input.agent}`,
    });

    return {
      mode: "background",
      task,
    };
  }

  if (!input.tasks || input.tasks.length === 0) {
    throw new Error("tasks array is required for parallel modes");
  }

  if (input.mode === "parallel_sync") {
    const outputs = await Promise.all(
      input.tasks.map(async (task, index) => {
        const output = await executeSyncDelegation(task.agent, task.prompt);
        return {
          index,
          agent: task.agent,
          output,
        };
      }),
    );

    return {
      mode: "parallel_sync",
      count: outputs.length,
      outputs,
    };
  }

  const launched = await Promise.all(
    input.tasks.map(async (task, index) => {
      const started = await startBackgroundDelegation({
        threadId: input.threadId,
        agent: task.agent,
        prompt: task.prompt,
        title: input.description ?? `Parallel background task ${index + 1}`,
      });

      return {
        index,
        agent: task.agent,
        task: started,
      };
    }),
  );

  return {
    mode: "parallel_background",
    count: launched.length,
    tasks: launched,
  };
}
