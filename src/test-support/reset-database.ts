import { ensureDatabaseInitialized } from "@/lib/db/bootstrap";
import { db } from "@/lib/db/client";
import {
  agentRuns,
  backgroundTasks,
  compactions,
  messages,
  reminders,
  runSteps,
  threads,
  todos,
  usageSnapshots,
} from "@/lib/db/schema";

export async function resetDatabase(): Promise<void> {
  ensureDatabaseInitialized();

  await db.delete(usageSnapshots);
  await db.delete(compactions);
  await db.delete(reminders);
  await db.delete(todos);
  await db.delete(backgroundTasks);
  await db.delete(runSteps);
  await db.delete(agentRuns);
  await db.delete(messages);
  await db.delete(threads);
}
