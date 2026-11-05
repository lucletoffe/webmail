import { defineConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMIN_DIR, ORGANISATION_POLICY, PORT } from "./fixtures";

// Sends from the composer against the built-in mock JMAP server and checks
// what the server is asked to store. Starts `next dev` on the mock, with an
// admin policy (fixtures.ts) the tests rely on; no mail server needed.
//
//   npm run test:compose-e2e
//   COMPOSE_E2E_BASE_URL=http://localhost:3000 npm run test:compose-e2e
//
// With COMPOSE_E2E_BASE_URL the tests use a server you started yourself,
// which must run on the mock with the policy of fixtures.ts.
const externalBaseUrl = (process.env.COMPOSE_E2E_BASE_URL ?? "").replace(/\/+$/, "");
mkdirSync(join(ADMIN_DIR, "config"), { recursive: true });
writeFileSync(join(ADMIN_DIR, "config", "policy.json"), JSON.stringify(ORGANISATION_POLICY, null, 2));

export default defineConfig({
  testDir: ".",
  testMatch: /\.spec\.ts$/,
  // next dev compiles each route on first use, which takes minutes on a busy machine.
  timeout: 600_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: "list",
  // Playwright empties this at the start of each run; failure traces stay out of the tree.
  outputDir: join(tmpdir(), "bulwark-compose-e2e-results"),
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: externalBaseUrl || `http://localhost:${PORT}`,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: externalBaseUrl ? undefined : {
    command: `npx next dev -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    cwd: process.cwd(),
    timeout: 300_000,
    env: {
      DEV_MOCK_JMAP: "true",
      JMAP_SERVER_URL: `http://localhost:${PORT}/api/dev-jmap`,
      SESSION_SECRET: "compose-e2e-session-secret-0123456789abcdef",
      ADMIN_CONFIG_DIR: join(ADMIN_DIR, "config"),
      ADMIN_STATE_DIR: join(ADMIN_DIR, "state"),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
