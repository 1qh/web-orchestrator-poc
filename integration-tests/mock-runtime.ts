import { vi } from "vitest";

const runtimeMocks = vi.hoisted(() => {
  const generateTextMock = vi.fn(async () => ({ text: "MOCK_BACKGROUND_OK" }));
  const convertToModelMessagesMock = vi.fn(async (messages: unknown) => messages);
  const stepCountIsMock = vi.fn((count: number) => count);
  const toolMock = vi.fn((definition: unknown) => definition);
  const streamTextMock = vi.fn((options: Record<string, unknown>) => ({
    toUIMessageStreamResponse: async ({
      originalMessages,
      onFinish,
    }: {
      originalMessages: Array<{
        id: string;
        role: string;
        parts: Array<{ type: string; text?: string }>;
      }>;
      onFinish?: (args: {
        messages: Array<{
          id: string;
          role: string;
          parts: Array<{ type: string; text?: string }>;
        }>;
        responseMessage: {
          id: string;
          role: string;
          parts: Array<{ type: string; text?: string }>;
        };
        isAborted: boolean;
      }) => Promise<void> | void;
    }) => {
      await (
        options.onStepFinish as ((event: Record<string, unknown>) => Promise<void>) | undefined
      )?.({
        finishReason: "stop",
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
          reasoningTokens: 0,
        },
        text: "MOCK_CHAT_REPLY",
        toolCalls: [],
      });

      await (
        options.onFinish as ((event: Record<string, unknown>) => Promise<void>) | undefined
      )?.({
        finishReason: "stop",
        totalUsage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
          reasoningTokens: 0,
        },
      });

      const responseMessage = {
        id: "msg_mock_assistant",
        role: "assistant",
        parts: [{ type: "text", text: "MOCK_CHAT_REPLY" }],
      };
      const messages = [...originalMessages, responseMessage];

      await onFinish?.({ messages, responseMessage, isAborted: false });

      return new Response("data: ok\n\n", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
    },
  }));

  const triggerMock = vi.fn(async () => ({ id: "trigger_mock" }));
  const googleMock = vi.fn((model: string) => ({ provider: "google", model }));

  return {
    generateTextMock,
    convertToModelMessagesMock,
    stepCountIsMock,
    toolMock,
    streamTextMock,
    triggerMock,
    googleMock,
  };
});

vi.mock("ai", () => ({
  generateText: runtimeMocks.generateTextMock,
  convertToModelMessages: runtimeMocks.convertToModelMessagesMock,
  stepCountIs: runtimeMocks.stepCountIsMock,
  streamText: runtimeMocks.streamTextMock,
  tool: runtimeMocks.toolMock,
}));

vi.mock("@ai-sdk/google", () => ({
  google: runtimeMocks.googleMock,
}));

vi.mock("@trigger.dev/sdk/v3", () => ({
  tasks: {
    trigger: runtimeMocks.triggerMock,
  },
}));

export function getRuntimeMocks() {
  return runtimeMocks;
}

export function clearRuntimeMocks(): void {
  runtimeMocks.generateTextMock.mockClear();
  runtimeMocks.convertToModelMessagesMock.mockClear();
  runtimeMocks.stepCountIsMock.mockClear();
  runtimeMocks.streamTextMock.mockClear();
  runtimeMocks.toolMock.mockClear();
  runtimeMocks.triggerMock.mockClear();
  runtimeMocks.googleMock.mockClear();
}
