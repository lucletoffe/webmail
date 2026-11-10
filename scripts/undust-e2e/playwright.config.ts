import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// undust fork: one pass through each patch the fork carries on top of
// upstream (composer signature and its copy, locked signature on external
// drafts, scheduled send, the upstream RSVP marker (our hatch is retired), custom keys,
// undust visio), against the mock JMAP server of a production build:
//
//   DEV_MOCK_JMAP=true npx next build --webpack
//   npx playwright test -c scripts/undust-e2e/playwright.config.ts
const port = Number(process.env.UNDUST_E2E_PORT || 3152);
const adminDir = mkdtempSync(join(tmpdir(), "undust-e2e-"));

export default defineConfig({
  testDir: ".",
  testMatch: /undust-patches\.spec\.ts$/,
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    locale: "en-US",
    timezoneId: "Europe/Paris",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: true,
    cwd: process.cwd(),
    timeout: 120_000,
    env: {
      DEV_MOCK_JMAP: "true",
      JMAP_SERVER_URL: `http://localhost:${port}/api/dev-jmap`,
      SESSION_SECRET: "undust-e2e-session-secret-0123456789abcdef",
      SETTINGS_SYNC_ENABLED: "true",
      ADMIN_CONFIG_DIR: join(adminDir, "config"),
      ADMIN_STATE_DIR: join(adminDir, "state"),
      SETTINGS_DATA_DIR: join(adminDir, "settings"),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
