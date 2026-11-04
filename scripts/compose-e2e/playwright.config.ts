import { defineConfig } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORGANISATION_POLICY } from "./fixtures";

// Sends from the composer against the built-in mock JMAP server and checks
// what the server is asked to store. Starts `next dev` on the mock, with an
// admin policy (fixtures.ts) the tests rely on; no mail server needed.
//
//   npm run test:compose-e2e
//   COMPOSE_E2E_BASE_URL=http://localhost:3000 npm run test:compose-e2e
//
// With COMPOSE_E2E_BASE_URL the tests use a server you started yourself,
// which must run on the mock with the policy of fixtures.ts.
const port = Number(process.env.COMPOSE_E2E_PORT || 3152);
const externalBaseUrl = (process.env.COMPOSE_E2E_BASE_URL ?? "").replace(/\/+$/, "");
const adminDir = mkdtempSync(join(tmpdir(), "compose-e2e-"));
mkdirSync(join(adminDir, "config"), { recursive: true });
writeFileSync(join(adminDir, "config", "policy.json"), JSON.stringify(ORGANISATION_POLICY, null, 2));

export default defineConfig({
  testDir: ".",
  testMatch: /\.spec\.ts$/,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: "list",
  // Traces and screenshots of a failure stay out of the working tree.
  outputDir: join(adminDir, "results"),
  use: {
    baseURL: externalBaseUrl || `http://localhost:${port}`,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: externalBaseUrl ? undefined : {
    command: `npx next dev -p ${port}`,
    port,
    reuseExistingServer: false,
    cwd: process.cwd(),
    timeout: 180_000,
    env: {
      DEV_MOCK_JMAP: "true",
      JMAP_SERVER_URL: `http://localhost:${port}/api/dev-jmap`,
      SESSION_SECRET: "compose-e2e-session-secret-0123456789abcdef",
      ADMIN_CONFIG_DIR: join(adminDir, "config"),
      ADMIN_STATE_DIR: join(adminDir, "state"),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
