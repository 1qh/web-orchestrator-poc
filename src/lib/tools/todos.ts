// Reference notes from oh-my-openagent:
// - src/tools/task/types.ts
// - src/tools/task/todo-sync.ts
import { z } from "zod";

import { createTodo, listTodos, updateTodo } from "@/lib/store";

export const todoToolInputSchema = z.object({
  action: z.enum(["list", "create", "update"]),
  threadId: z.string(),
  todoId: z.string().optional(),
  content: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

export type TodoToolInput = z.infer<typeof todoToolInputSchema>;

export async function runTodoTool(input: TodoToolInput): Promise<unknown> {
  if (input.action === "list") {
    return {
      todos: await listTodos(input.threadId),
    };
  }

  if (input.action === "create") {
    if (!input.content) {
      throw new Error("content is required when action=create");
    }

    const todo = await createTodo({
      threadId: input.threadId,
      content: input.content,
      priority: input.priority,
    });

    return {
      created: todo,
    };
  }

  if (!input.todoId) {
    throw new Error("todoId is required when action=update");
  }

  await updateTodo({
    todoId: input.todoId,
    content: input.content,
    status: input.status,
    priority: input.priority,
  });

  return {
    updated: {
      id: input.todoId,
      status: input.status,
      content: input.content,
      priority: input.priority,
    },
  };
}
