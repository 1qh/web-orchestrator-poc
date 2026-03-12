import { compose, ensureDockerComposeAvailable, ensureTriggerRepoCloned } from "./common";

function main(): void {
  ensureDockerComposeAvailable();
  ensureTriggerRepoCloned();
  compose(["down"]);
  console.log("TRIGGER_SELFHOST_DOWN");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`TRIGGER_SELFHOST_STOP_FAILED: ${message}`);
  process.exitCode = 1;
}
