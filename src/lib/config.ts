const resolvedGoogleApiKey =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_VERTEX_API_KEY;

if (resolvedGoogleApiKey && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = resolvedGoogleApiKey;
}

export const HAS_GOOGLE_API_KEY = Boolean(resolvedGoogleApiKey);

export const DEFAULT_MODEL = process.env.ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export const GROUNDING_MODEL =
  process.env.GROUNDING_MODEL ?? process.env.ORCHESTRATOR_MODEL ?? "gemini-2.5-flash";

export const CONTEXT_TOKEN_BUDGET = Number(process.env.CONTEXT_TOKEN_BUDGET ?? "24000");

export const CONTEXT_COMPACTION_TRIGGER_RATIO = Number(
  process.env.CONTEXT_COMPACTION_TRIGGER_RATIO ?? "0.75",
);

export const UNFINISHED_TODO_REMINDER_MINUTES = Number(
  process.env.UNFINISHED_TODO_REMINDER_MINUTES ?? "10",
);

export const MCP_SERVERS = process.env.MCP_SERVERS_JSON
  ? (JSON.parse(process.env.MCP_SERVERS_JSON) as Array<{
      name: string;
      url: string;
      headers?: Record<string, string>;
    }>)
  : [];

export const APP_NAME = "Web Orchestrator";
