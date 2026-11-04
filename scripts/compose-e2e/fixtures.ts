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
