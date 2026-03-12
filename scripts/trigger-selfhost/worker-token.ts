import { compose, ensureDockerComposeAvailable, ensureTriggerRepoCloned } from "./common";

function main(): void {
  ensureDockerComposeAvailable();
  ensureTriggerRepoCloned();

  const logs = compose(["logs", "webapp", "--tail", "400"]);
  const token = logs.match(/tr_wgt_[A-Za-z0-9]+/)?.[0] ?? null;
  if (!token) {
    throw new Error("Worker token not found in recent webapp logs");
  }

  console.log(token);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`TRIGGER_SELFHOST_WORKER_TOKEN_FAILED: ${message}`);
  process.exitCode = 1;
}
