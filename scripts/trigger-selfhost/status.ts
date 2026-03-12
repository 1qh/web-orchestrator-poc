import {
  compose,
  ensureDockerComposeAvailable,
  ensureTriggerRepoCloned,
  SELFHOST_WEBAPP_URL,
} from "./common";

async function main(): Promise<void> {
  ensureDockerComposeAvailable();
  ensureTriggerRepoCloned();

  const ps = compose(["ps"]);
  console.log(ps);

  const response = await fetch(SELFHOST_WEBAPP_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Trigger webapp is not healthy: ${response.status}`);
  }

  console.log("TRIGGER_SELFHOST_STATUS_OK");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`TRIGGER_SELFHOST_STATUS_FAILED: ${message}`);
  process.exitCode = 1;
});
