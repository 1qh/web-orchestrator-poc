import { compose, ensureDockerComposeAvailable, ensureTriggerRepoCloned } from "./common";

function main(): void {
  ensureDockerComposeAvailable();
  ensureTriggerRepoCloned();
  compose(["down", "-v", "--remove-orphans"]);
  console.log("TRIGGER_SELFHOST_RESET");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`TRIGGER_SELFHOST_RESET_FAILED: ${message}`);
  process.exitCode = 1;
}
