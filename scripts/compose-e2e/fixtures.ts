import { tmpdir } from "node:os";
import { join } from "node:path";

/** A 1×1 PNG, as an organisation might embed its logo. */
export const LOGO_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** policy.json for the test server: a locked organisation signature with an embedded logo. */
export const ORGANISATION_POLICY = {
  restrictions: { signature: { locked: true } },
  organisation: {
    signature: {
      html: `<p><b>{name}</b></p><p><img src="data:image/png;base64,${LOGO_PNG}" alt="ACME logo" width="120"></p>`,
      text: "{name}\nACME",
      fields: [],
    },
  },
};

export const PORT = Number(process.env.COMPOSE_E2E_PORT || 3152);

/**
 * The test server's admin config and state. One fixed path per port: the
 * config file is evaluated again in each worker, and global-teardown.ts
 * removes it when the run ends.
 */
export const ADMIN_DIR = join(tmpdir(), `bulwark-compose-e2e-${PORT}`);
