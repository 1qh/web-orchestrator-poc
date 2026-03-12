"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

import {
  createThreadAction,
  startBackgroundDelegationAction,
  updateTodoAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

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

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return String(Math.abs(hash));
}

function getPartKey(messageId: string, part: UIMessage["parts"][number]): string {
  return `${messageId}-${part.type}-${hashString(JSON.stringify(part))}`;
}

function MessagePartView({ part }: { part: UIMessage["parts"][number] }) {
  if (part.type === "text") {
    return <div className="rounded-md border bg-card p-3 leading-6">{part.text}</div>;
  }

  if (part.type === "reasoning") {
    return (
      <div className="rounded-md border bg-muted/50 p-3 text-sm">
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Reasoning</div>
        <div className="leading-6">{part.text}</div>
      </div>
    );
  }

  if (part.type === "step-start") {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-2 text-xs text-muted-foreground">
        Step started
      </div>
    );
  }

  if (part.type === "source-url") {
    return (
      <div className="rounded-md border bg-secondary/40 p-2 text-xs">
        Source: <a href={part.url}>{part.title ?? part.url}</a>
      </div>
    );
  }

  if (part.type === "source-document") {
    return (
      <div className="rounded-md border bg-secondary/40 p-2 text-xs">
        Source document: {part.title}
      </div>
    );
  }

  if (part.type === "dynamic-tool") {
    return (
      <div className="rounded-md border bg-accent/40 p-2">
        <div className="mb-1 text-xs font-medium">
          Tool ({part.toolName}) [{part.state}]
        </div>
        <pre className="overflow-x-auto rounded-md bg-background p-2 text-xs">
          {JSON.stringify(part, null, 2)}
        </pre>
      </div>
    );
  }

  if (part.type.startsWith("tool-")) {
    const toolName = part.type.replace("tool-", "");
    const state = "state" in part ? String(part.state) : "unknown";
    return (
      <div className="rounded-md border bg-accent/40 p-2">
        <div className="mb-1 text-xs font-medium">
          Tool ({toolName}) [{state}]
        </div>
        <pre className="overflow-x-auto rounded-md bg-background p-2 text-xs">
          {JSON.stringify(part, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-md border bg-background p-2 text-xs">
      {JSON.stringify(part, null, 2)}
    </pre>
  );
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
    <div className="flex h-[70vh] min-h-0 flex-col gap-3 lg:h-[calc(100vh-10rem)]">
      <ScrollArea className="min-h-0 flex-1 rounded-md border bg-card p-3">
        <div className="space-y-3">
          {chat.messages.map((message) => (
            <div
              key={message.id}
              className="rounded-md border bg-background p-3 shadow-sm"
            >
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                {message.role}
              </div>
              <div className="space-y-2">
                {message.parts.map((part) => (
                  <MessagePartView key={getPartKey(message.id, part)} part={part} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = input.trim();
          if (!value) {
            return;
          }
          chat.sendMessage({ text: value });
        }}
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the orchestrator..."
        />
        <Button type="submit" disabled={chat.status === "streaming" || chat.status === "submitted"}>
          Send
        </Button>
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

  const reloadThreads = useCallback(async () => {
    const response = await fetch("/api/threads", { cache: "no-store" });
    const payload = (await response.json()) as { threads: ThreadSummary[] };
    setThreads(payload.threads);

    if (!selectedThreadId) {
      setSelectedThreadId(payload.threads[0]?.id ?? null);
    }
  }, [selectedThreadId]);

  const reloadThreadState = useCallback(async (threadId: string) => {
    const response = await fetch(`/api/threads/${threadId}/state`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as ThreadState;
    setThreadState(payload);
    setChatRenderKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/threads", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ threads: ThreadSummary[] }>)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setThreads(payload.threads);
        if (!selectedThreadId) {
          setSelectedThreadId(payload.threads[0]?.id ?? null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }

    let cancelled = false;

    void fetch(`/api/threads/${selectedThreadId}/state`, {
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) {
          return null;
        }

        return response.json() as Promise<ThreadState>;
      })
      .then((payload) => {
        if (!payload || cancelled) {
          return;
        }

        setThreadState(payload);
        setChatRenderKey((value) => value + 1);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || isStreaming) {
      return;
    }

    const runningTasks = threadState.backgroundTasks.filter(
      (task) => task.status === "pending" || task.status === "running",
    );
    if (runningTasks.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      void Promise.all(
        runningTasks.map(async (task) => {
          const response = await fetch(`/api/background/${task.id}`, {
            cache: "no-store",
          });

          if (!response.ok) {
            return task;
          }

          const payload = (await response.json()) as { task: BackgroundTask };
          return payload.task;
        }),
      ).then((polled) => {
        setThreadState((previous) => ({
          ...previous,
          backgroundTasks: previous.backgroundTasks.map((task) => {
            const fresh = polled.find((item) => item.id === task.id);
            return fresh ?? task;
          }),
        }));

        const hasTerminalUpdate = polled.some((task) => {
          return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
        });

        if (hasTerminalUpdate) {
          void reloadThreadState(selectedThreadId);
        }
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedThreadId, isStreaming, threadState.backgroundTasks, reloadThreadState]);

  const selectedThread = useMemo(() => {
    return threads.find((thread) => thread.id === selectedThreadId) ?? null;
  }, [threads, selectedThreadId]);

  return (
    <main className="min-h-screen bg-background px-3 py-4 text-foreground lg:px-6 lg:py-6">
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Threads</CardTitle>
            <CardDescription>Persistent conversations in SQLite</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              type="button"
              className="w-full"
              variant="secondary"
              onClick={() => {
                startTransition(async () => {
                  const created = await createThreadAction("New Web Orchestrator Thread");
                  await reloadThreads();
                  setSelectedThreadId(created.id);
                });
              }}
              disabled={pending}
            >
              New Thread
            </Button>

            <ScrollArea className="h-[60vh] rounded-md border">
              <div className="space-y-2 p-2">
                {threads.map((thread) => (
                  <Button
                    key={thread.id}
                    type="button"
                    variant={thread.id === selectedThreadId ? "default" : "outline"}
                    className="h-auto w-full justify-start py-2 text-left"
                    onClick={() => setSelectedThreadId(thread.id)}
                  >
                    <div className="flex flex-col items-start gap-1">
                      <span className="line-clamp-2 text-sm">{thread.title}</span>
                      <span className="text-xs text-muted-foreground">{thread.id}</span>
                    </div>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {selectedThread ? selectedThread.title : "No thread selected"}
            </CardTitle>
            <CardDescription>
              Reasoning, response, and tool calls are streamed visibly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedThreadId ? (
              <ChatPanel
                key={`${selectedThreadId}-${chatRenderKey}`}
                threadId={selectedThreadId}
                initialMessages={threadState.messages}
                onRefresh={async () => {
                  await reloadThreadState(selectedThreadId);
                }}
                onStatusChange={setIsStreaming}
              />
            ) : (
              <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
                Create a thread to start chatting.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">State</CardTitle>
            <CardDescription>Background tasks, todos, reminders, and usage</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[72vh] pr-2">
              <div className="space-y-4">
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-medium">Token Usage</div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>Prompt: {threadState.usage.promptTokens}</div>
                    <div>Completion: {threadState.usage.completionTokens}</div>
                    <div>Total: {threadState.usage.totalTokens}</div>
                    <div>Reasoning: {threadState.usage.reasoningTokens}</div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-medium">Todos</div>
                  <div className="space-y-2">
                    {threadState.todos.map((todo) => (
                      <div key={todo.id} className="space-y-2 rounded-md border p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm leading-5">{todo.content}</div>
                          <Badge variant="secondary">{todo.priority}</Badge>
                        </div>
                        <Select
                          value={todo.status}
                          onValueChange={(nextStatus) => {
                            startTransition(async () => {
                              await updateTodoAction({
                                todoId: todo.id,
                                status: nextStatus as Todo["status"],
                              });
                              if (selectedThreadId) {
                                await reloadThreadState(selectedThreadId);
                              }
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">pending</SelectItem>
                            <SelectItem value="in_progress">in_progress</SelectItem>
                            <SelectItem value="completed">completed</SelectItem>
                            <SelectItem value="cancelled">cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-medium">Background Tasks</div>
                  <div className="space-y-2">
                    {threadState.backgroundTasks.map((task) => (
                      <div key={task.id} className="rounded-md border p-2 text-xs">
                        <div className="font-medium">{task.id}</div>
                        <div className="text-muted-foreground">
                          {task.agent} - {task.status}
                        </div>
                        <div>Progress: {task.progress}%</div>
                      </div>
                    ))}
                  </div>
                  {!isStreaming &&
                  threadState.backgroundTasks.some(
                    (task) => task.status === "pending" || task.status === "running",
                  ) ? (
                    <Badge variant="outline">Conversation remains usable while tasks run.</Badge>
                  ) : null}
                </div>

                <Separator />

                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-medium">Manual Background Delegation</div>
                  <Input
                    value={manualAgent}
                    onChange={(event) => setManualAgent(event.target.value)}
                    placeholder="agent"
                  />
                  <Textarea
                    value={manualPrompt}
                    onChange={(event) => setManualPrompt(event.target.value)}
                    rows={4}
                  />
                  <Button
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

                        await reloadThreadState(selectedThreadId);
                      });
                    }}
                    disabled={!selectedThreadId || pending}
                  >
                    Run Background Task
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
