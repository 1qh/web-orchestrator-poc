"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { DefaultChatTransport, type UIMessage, useChat } from "ai";

import {
  createThreadAction,
  startBackgroundDelegationAction,
  updateTodoAction,
} from "@/app/actions";

type ThreadSummary = {
  id: string;
  title: string;
  updatedAt: number;
  lastActivityAt: number;
};

type Todo = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high";
  createdAt: number;
  updatedAt: number;
};

type BackgroundTask = {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  taskType: string;
  agent: string;
  progress: number;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
};

type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
};

type ThreadState = {
  messages: UIMessage[];
  todos: Todo[];
  backgroundTasks: BackgroundTask[];
  usage: Usage;
};

const EMPTY_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
};

function MessagePartView({ part }: { part: UIMessage["parts"][number] }) {
  if (part.type === "text") {
    return <div className="part part-text">{part.text}</div>;
  }

  if (part.type === "reasoning") {
    return <div className="part part-reasoning">Reasoning: {part.text}</div>;
  }

  if (part.type === "step-start") {
    return <div className="part part-step">Step started</div>;
  }

  if (part.type === "source-url") {
    return (
      <div className="part part-source">
        Source: <a href={part.url}>{part.title ?? part.url}</a>
      </div>
    );
  }

  if (part.type === "source-document") {
    return <div className="part part-source">Source document: {part.title}</div>;
  }

  if (part.type === "dynamic-tool") {
    return (
      <div className="part part-tool">
        Tool ({part.toolName}) [{part.state}]
        <pre>{JSON.stringify(part, null, 2)}</pre>
      </div>
    );
  }

  if (part.type.startsWith("tool-")) {
    const toolName = part.type.replace("tool-", "");
    const state = "state" in part ? String(part.state) : "unknown";
    return (
      <div className="part part-tool">
        Tool ({toolName}) [{state}]
        <pre>{JSON.stringify(part, null, 2)}</pre>
      </div>
    );
  }

  return <div className="part part-unknown">{JSON.stringify(part)}</div>;
}

function getPartKey(messageId: string, part: UIMessage["parts"][number]): string {
  if (part.type === "text" || part.type === "reasoning") {
    return `${messageId}-${part.type}-${part.text.slice(0, 32)}`;
  }

  if (part.type === "dynamic-tool") {
    return `${messageId}-dynamic-${part.toolCallId}-${part.toolName}`;
  }

  if (part.type.startsWith("tool-") && "toolCallId" in part) {
    return `${messageId}-${part.type}-${part.toolCallId}`;
  }

  if (part.type === "source-url") {
    return `${messageId}-source-url-${part.url}`;
  }

  if (part.type === "source-document") {
    return `${messageId}-source-doc-${part.sourceId}`;
  }

  return `${messageId}-${part.type}`;
}

function ChatPanel(args: {
  threadId: string;
  initialMessages: UIMessage[];
  onRefresh: () => Promise<void>;
  onStatusChange: (isStreaming: boolean) => void;
}) {
  const { threadId, initialMessages, onRefresh, onStatusChange } = args;
  const [input, setInput] = useState("");

  const chat = useChat<UIMessage>({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest({ id, messages }) {
        const lastMessage = messages[messages.length - 1];
        return {
          body: {
            id,
            message: lastMessage,
          },
        };
      },
    }),
    onFinish: async () => {
      setInput("");
      await onRefresh();
    },
    onError: () => {
      onStatusChange(false);
    },
  });

  useEffect(() => {
    onStatusChange(chat.status === "streaming" || chat.status === "submitted");
  }, [chat.status, onStatusChange]);

  return (
    <div className="chat-panel">
      <div className="messages">
        {chat.messages.map((message) => (
          <div key={message.id} className={`message message-${message.role}`}>
            <div className="message-role">{message.role}</div>
            <div className="message-parts">
              {message.parts.map((part) => (
                <MessagePartView key={getPartKey(message.id, part)} part={part} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          const value = input.trim();
          if (!value) {
            return;
          }
          chat.sendMessage({ text: value });
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the orchestrator..."
        />
        <button type="submit" disabled={chat.status === "streaming" || chat.status === "submitted"}>
          Send
        </button>
      </form>
    </div>
  );
}

export function OrchestratorApp() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadState, setThreadState] = useState<ThreadState>({
    messages: [],
    todos: [],
    backgroundTasks: [],
    usage: EMPTY_USAGE,
  });
  const [chatRenderKey, setChatRenderKey] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [manualAgent, setManualAgent] = useState("researcher");
  const [manualPrompt, setManualPrompt] = useState("Summarize the latest AI SDK v6 updates.");

  const loadThreads = useCallback(async () => {
    const response = await fetch("/api/threads", { cache: "no-store" });
    const payload = (await response.json()) as { threads: ThreadSummary[] };
    setThreads(payload.threads);

    if (!selectedThreadId) {
      setSelectedThreadId(payload.threads[0]?.id ?? null);
    }
  }, [selectedThreadId]);

  const loadThreadState = useCallback(
    async (threadId: string) => {
      const response = await fetch(`/api/threads/${threadId}/state`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        messages: UIMessage[];
        todos: Todo[];
        backgroundTasks: BackgroundTask[];
        usage: Usage;
      };

      setThreadState({
        messages: payload.messages,
        todos: payload.todos,
        backgroundTasks: payload.backgroundTasks,
        usage: payload.usage,
      });
      setChatRenderKey((value) => value + 1);
    },
    [],
  );

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }
    void loadThreadState(selectedThreadId);
  }, [selectedThreadId, loadThreadState]);

  useEffect(() => {
    if (!selectedThreadId || isStreaming) {
      return;
    }

    const hasPendingTasks = threadState.backgroundTasks.some(
      (task) => task.status === "pending" || task.status === "running",
    );
    if (!hasPendingTasks) {
      return;
    }

    const interval = setInterval(() => {
      void loadThreadState(selectedThreadId);
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedThreadId, isStreaming, threadState.backgroundTasks, loadThreadState]);

  const selectedThread = useMemo(() => {
    return threads.find((thread) => thread.id === selectedThreadId) ?? null;
  }, [threads, selectedThreadId]);

  return (
    <main className="orchestrator-root">
      <section className="threads-panel">
        <div className="panel-title">Threads</div>
        <button
          type="button"
          onClick={() => {
            startTransition(async () => {
              const created = await createThreadAction("New Web Orchestrator Thread");
              await loadThreads();
              setSelectedThreadId(created.id);
            });
          }}
          disabled={pending}
        >
          New Thread
        </button>
        <div className="thread-list">
          {threads.map((thread) => (
            <button
              type="button"
              key={thread.id}
              className={thread.id === selectedThreadId ? "thread-button active" : "thread-button"}
              onClick={() => setSelectedThreadId(thread.id)}
            >
              {thread.title}
            </button>
          ))}
        </div>
      </section>

      <section className="chat-section">
        <div className="panel-title">
          {selectedThread ? `${selectedThread.title} (${selectedThread.id})` : "No thread selected"}
        </div>

        {selectedThreadId ? (
          <ChatPanel
            key={`${selectedThreadId}-${chatRenderKey}`}
            threadId={selectedThreadId}
            initialMessages={threadState.messages}
            onRefresh={async () => {
              await loadThreadState(selectedThreadId);
            }}
            onStatusChange={setIsStreaming}
          />
        ) : (
          <div className="empty-thread">Create a thread to start chatting.</div>
        )}
      </section>

      <section className="state-panel">
        <div className="panel-title">State</div>

        <div className="state-block">
          <div className="state-title">Token Usage</div>
          <div>Prompt: {threadState.usage.promptTokens}</div>
          <div>Completion: {threadState.usage.completionTokens}</div>
          <div>Total: {threadState.usage.totalTokens}</div>
          <div>Reasoning: {threadState.usage.reasoningTokens}</div>
        </div>

        <div className="state-block">
          <div className="state-title">Todos</div>
          {threadState.todos.map((todo) => (
            <div key={todo.id} className="todo-row">
              <div>{todo.content}</div>
              <select
                value={todo.status}
                onChange={(event) => {
                  const nextStatus = event.target.value as Todo["status"];
                  startTransition(async () => {
                    await updateTodoAction({ todoId: todo.id, status: nextStatus });
                    if (selectedThreadId) {
                      await loadThreadState(selectedThreadId);
                    }
                  });
                }}
              >
                <option value="pending">pending</option>
                <option value="in_progress">in_progress</option>
                <option value="completed">completed</option>
                <option value="cancelled">cancelled</option>
              </select>
            </div>
          ))}
        </div>

        <div className="state-block">
          <div className="state-title">Background Tasks</div>
          {threadState.backgroundTasks.map((task) => (
            <div key={task.id} className="task-row">
              <div>{task.id}</div>
              <div>
                {task.agent} - {task.status} ({task.progress}%)
              </div>
            </div>
          ))}
        </div>

        <div className="state-block">
          <div className="state-title">Manual Background Delegation</div>
          <input
            value={manualAgent}
            onChange={(event) => setManualAgent(event.target.value)}
            placeholder="agent"
          />
          <textarea
            value={manualPrompt}
            onChange={(event) => setManualPrompt(event.target.value)}
            rows={4}
          />
          <button
            type="button"
            onClick={() => {
              if (!selectedThreadId) {
                return;
              }

              startTransition(async () => {
                await startBackgroundDelegationAction({
                  threadId: selectedThreadId,
                  agent: manualAgent,
                  prompt: manualPrompt,
                  title: `Manual background delegation (${manualAgent})`,
                });

                await loadThreadState(selectedThreadId);
              });
            }}
            disabled={!selectedThreadId || pending}
          >
            Run Background Task
          </button>
        </div>
      </section>
    </main>
  );
}
