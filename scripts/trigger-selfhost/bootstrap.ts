import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  compose,
  ensureDockerComposeAvailable,
  ensureTriggerRepoCloned,
  SELFHOST_WEBAPP_URL,
  waitForWebappReady,
} from "./common";

const LOCAL_ORG_ID = "org_local";
const LOCAL_PROJECT_ID = "proj_local";
const LOCAL_ENV_ID = "env_local_dev";
const LOCAL_USER_ID = "user_local";
const LOCAL_MEMBER_ID = "member_local";
const LOCAL_PAT_ID = "pat_local_1";
const LOCAL_OAT_ID = "oat_local_1";

const LOCAL_PROJECT_REF = "web-orchestrator-poc";
const LOCAL_RUNTIME_SECRET_KEY = "tr_dev_local_dev_key_123";
const LOCAL_OAT_TOKEN = "tr_oat_localselfhost123456789abcdefghijkmnopqrstuvwxyz";
const LOCAL_CALLBACK_SECRET = "trigger-local-selfhost-callback-secret";

type BootstrapResult = {
  triggerApiUrl: string;
  triggerProjectRef: string;
  triggerSecretKey: string;
  triggerAccessToken: string;
  backgroundCallbackSecret: string;
};

function runOrThrow(command: string, args: string[], input?: string): string {
  const result = spawnSync(command, args, {
    env: { ...process.env },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    input,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status ?? 1})${
        stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : ""
      }`,
    );
  }

  return (result.stdout ?? "").trim();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function obfuscatePatToken(token: string): string {
  const prefix = "tr_pat_";
  const withoutPrefix = token.startsWith(prefix) ? token.slice(prefix.length) : token;
  const masked = `${withoutPrefix.slice(0, 4)}******************${withoutPrefix.slice(-4)}`;
  return `${prefix}${masked}`;
}

function generatePatToken(): string {
  const alphabet = "123456789abcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let index = 0; index < 40; index += 1) {
    out += alphabet[randomBytes(1)[0] % alphabet.length];
  }

  return `tr_pat_${out}`;
}

function encryptToken(token: string, key: string): { nonce: string; ciphertext: string; tag: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);

  let ciphertext = cipher.update(token, "utf8", "hex");
  ciphertext += cipher.final("hex");

  return {
    nonce: nonce.toString("hex"),
    ciphertext,
    tag: cipher.getAuthTag().toString("hex"),
  };
}

function getServiceContainerId(serviceName: string): string {
  const id = compose(["ps", "-q", serviceName]);
  if (!id) {
    throw new Error(`Service container not found: ${serviceName}. Start self-host stack first.`);
  }

  return id;
}

function dockerExec(containerId: string, command: string): string {
  return runOrThrow("docker", ["exec", containerId, "sh", "-lc", command]);
}

function runPostgresSql(postgresContainerId: string, sql: string): void {
  runOrThrow("docker", ["exec", "-i", postgresContainerId, "psql", "-U", "postgres", "-d", "main"], sql);
}

async function seedSelfHost(): Promise<BootstrapResult> {
  const webappContainerId = getServiceContainerId("webapp");
  const postgresContainerId = getServiceContainerId("postgres");

  let encryptionKey = "";
  for (let attempts = 0; attempts < 30; attempts += 1) {
    encryptionKey = dockerExec(webappContainerId, "printenv ENCRYPTION_KEY");
    if (encryptionKey.length === 32) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (encryptionKey.length !== 32) {
    throw new Error("Invalid ENCRYPTION_KEY from trigger webapp container");
  }

  const patToken = generatePatToken();
  const patEncrypted = encryptToken(patToken, encryptionKey);
  const patEncryptedJson = JSON.stringify(patEncrypted);

  const projectSql = [
    `INSERT INTO "Organization" (id, slug, title, "updatedAt") VALUES ('${LOCAL_ORG_ID}', 'local-org', 'Local Org', NOW()) ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, "updatedAt" = NOW();`,
    `INSERT INTO "Project" (id, name, "organizationId", slug, "externalRef", "updatedAt", version, engine) VALUES ('${LOCAL_PROJECT_ID}', 'Web Orchestrator', '${LOCAL_ORG_ID}', 'web-orchestrator', '${LOCAL_PROJECT_REF}', NOW(), 'V2', 'V2') ON CONFLICT (id) DO UPDATE SET "organizationId" = EXCLUDED."organizationId", name = EXCLUDED.name, slug = EXCLUDED.slug, "externalRef" = EXCLUDED."externalRef", "updatedAt" = NOW(), version = 'V2', engine = 'V2';`,
    `INSERT INTO "User" (id, "updatedAt", "authenticationMethod", email, name) VALUES ('${LOCAL_USER_ID}', NOW(), 'MAGIC_LINK', 'local@example.com', 'Local User') ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, "updatedAt" = NOW();`,
    `INSERT INTO "OrgMember" (id, "organizationId", "userId", role, "updatedAt") VALUES ('${LOCAL_MEMBER_ID}', '${LOCAL_ORG_ID}', '${LOCAL_USER_ID}', 'ADMIN', NOW()) ON CONFLICT (id) DO UPDATE SET "organizationId" = EXCLUDED."organizationId", "userId" = EXCLUDED."userId", role = EXCLUDED.role, "updatedAt" = NOW();`,
    `INSERT INTO "RuntimeEnvironment" (id, slug, "apiKey", "organizationId", "updatedAt", "projectId", type, "pkApiKey", shortcode, "orgMemberId") VALUES ('${LOCAL_ENV_ID}', 'dev', '${LOCAL_RUNTIME_SECRET_KEY}', '${LOCAL_ORG_ID}', NOW(), '${LOCAL_PROJECT_ID}', 'DEVELOPMENT', 'tr_pk_local_dev_key_123', 'locdev', '${LOCAL_MEMBER_ID}') ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, "apiKey" = EXCLUDED."apiKey", "organizationId" = EXCLUDED."organizationId", "projectId" = EXCLUDED."projectId", type = EXCLUDED.type, "pkApiKey" = EXCLUDED."pkApiKey", shortcode = EXCLUDED.shortcode, "orgMemberId" = EXCLUDED."orgMemberId", "updatedAt" = NOW();`,
    `INSERT INTO "OrganizationAccessToken" (id, name, type, "hashedToken", "organizationId", "createdAt", "updatedAt") VALUES ('${LOCAL_OAT_ID}', 'local-selfhost-oat', 'USER', '${hashToken(LOCAL_OAT_TOKEN)}', '${LOCAL_ORG_ID}', NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET "hashedToken" = EXCLUDED."hashedToken", "organizationId" = EXCLUDED."organizationId", name = EXCLUDED.name, "updatedAt" = NOW();`,
    `INSERT INTO "PersonalAccessToken" (id, name, "userId", "updatedAt", "obfuscatedToken", "encryptedToken", "hashedToken") VALUES ('${LOCAL_PAT_ID}', 'cli', '${LOCAL_USER_ID}', NOW(), '${obfuscatePatToken(patToken)}', '${patEncryptedJson}'::jsonb, '${hashToken(patToken)}') ON CONFLICT (id) DO UPDATE SET "userId" = EXCLUDED."userId", name = EXCLUDED.name, "obfuscatedToken" = EXCLUDED."obfuscatedToken", "encryptedToken" = EXCLUDED."encryptedToken", "hashedToken" = EXCLUDED."hashedToken", "updatedAt" = NOW();`,
  ].join("\n");

  runPostgresSql(postgresContainerId, projectSql);

  return {
    triggerApiUrl: SELFHOST_WEBAPP_URL,
    triggerProjectRef: LOCAL_PROJECT_REF,
    triggerSecretKey: LOCAL_RUNTIME_SECRET_KEY,
    triggerAccessToken: patToken,
    backgroundCallbackSecret: LOCAL_CALLBACK_SECRET,
  };
}

function printExports(result: BootstrapResult): void {
  console.log(`export USE_TRIGGER_DEV=true`);
  console.log(`export TRIGGER_API_URL=${result.triggerApiUrl}`);
  console.log(`export TRIGGER_PROJECT_REF=${result.triggerProjectRef}`);
  console.log(`export TRIGGER_SECRET_KEY=${result.triggerSecretKey}`);
  console.log(`export TRIGGER_ACCESS_TOKEN=${result.triggerAccessToken}`);
  console.log(`export BACKGROUND_CALLBACK_SECRET=${result.backgroundCallbackSecret}`);
}

async function main(): Promise<void> {
  const exportsOnly = process.argv.includes("--exports-only");

  ensureDockerComposeAvailable();
  ensureTriggerRepoCloned();
  await waitForWebappReady(SELFHOST_WEBAPP_URL);

  const result = await seedSelfHost();

  if (!exportsOnly) {
    console.log("TRIGGER_SELFHOST_BOOTSTRAP_OK");
    console.log("Run this before strict live Trigger verification:");
  }

  printExports(result);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`TRIGGER_SELFHOST_BOOTSTRAP_FAILED: ${message}`);
  process.exitCode = 1;
});
