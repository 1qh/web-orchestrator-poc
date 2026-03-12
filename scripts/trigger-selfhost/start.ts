import {
  compose,
  ensureDockerComposeAvailable,
  ensureTriggerEnvFile,
  ensureLocalSelfHostEnvOverrides,
  ensureLocalSelfHostPortOverrides,
  ensureTriggerRepoCloned,
  SELFHOST_WEBAPP_URL,
  waitForWebappReady,
} from "./common";

async function main(): Promise<void> {
  ensureDockerComposeAvailable();
  ensureTriggerRepoCloned();
  ensureTriggerEnvFile();
  ensureLocalSelfHostEnvOverrides();
  ensureLocalSelfHostPortOverrides();

  try {
    compose(["down", "--remove-orphans"]);
  } catch (error) {
    void error;
  }

  compose(["up", "-d"]);
  await waitForWebappReady(SELFHOST_WEBAPP_URL);

  console.log("TRIGGER_SELFHOST_UP");
  console.log("Dashboard: http://localhost:18030");
  console.log("MinIO: http://localhost:19001");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`TRIGGER_SELFHOST_START_FAILED: ${message}`);
  process.exitCode = 1;
});
