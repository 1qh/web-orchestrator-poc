"use server";

import {
  runDelegationTool,
  type DelegateToolInput,
} from "@/lib/tools/delegation";
import { listMcpServerTools, listMcpServers, runMcpTool } from "@/lib/tools/mcp";
import { runGroundedSearch } from "@/lib/tools/search";
import { runTodoTool, type TodoToolInput } from "@/lib/tools/todos";

export async function executeSearchAction(query: string): Promise<Awaited<ReturnType<typeof runGroundedSearch>>> {
  return runGroundedSearch(query);
}

export async function executeTodoAction(input: TodoToolInput): Promise<unknown> {
  return runTodoTool(input);
}

export async function executeDelegationAction(input: DelegateToolInput): Promise<unknown> {
  return runDelegationTool(input);
}

export async function listMcpServersAction(): Promise<ReturnType<typeof listMcpServers>> {
  return listMcpServers();
}

export async function listMcpServerToolsAction(
  serverName: string,
): Promise<Awaited<ReturnType<typeof listMcpServerTools>>> {
  return listMcpServerTools(serverName);
}

export async function executeMcpToolAction(args: {
  serverName: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
}): Promise<Awaited<ReturnType<typeof runMcpTool>>> {
  return runMcpTool(args);
}
