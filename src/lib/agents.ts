export function getAgentInstruction(agent: string): string {
  const key = agent.trim().toLowerCase();

  if (key === "researcher") {
    return "You are a focused researcher. Prioritize factual, cited, concise outputs.";
  }

  if (key === "planner") {
    return "You are a planner. Return clear step-by-step plans with explicit decisions.";
  }

  if (key === "writer") {
    return "You are a writer. Produce structured, readable, action-oriented responses.";
  }

  return `You are a specialist subagent named ${agent}. Complete the delegated task and return concise, useful output.`;
}
