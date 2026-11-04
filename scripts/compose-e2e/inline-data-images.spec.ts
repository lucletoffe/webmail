import { test, expect, type Page, type Request } from "@playwright/test";

/**
 * Gmail and Outlook don't show data: images. A logo embedded in the
 * organisation signature (fixtures.ts) must reach the server as a cid:
 * reference and an inline part of the message, not as a data: URI.
 */

type BodyPart = { type?: string; blobId?: string; cid?: string; disposition?: string; partId?: string; subParts?: BodyPart[] };
type EmailCreate = { bodyValues?: Record<string, { value: string }>; bodyStructure?: BodyPart; attachments?: BodyPart[] };

function methodCalls(request: Request): Array<[string, Record<string, unknown>, string]> {
  try {
    return JSON.parse(request.postData() || "{}").methodCalls ?? [];
  } catch {
    return [];
  }
}

/** The Email/set create of the request that submits a message. */
function submittedEmail(request: Request): EmailCreate | null {
  const calls = methodCalls(request);
  if (!calls.some(([name]) => name === "EmailSubmission/set")) return null;
  const emailSet = calls.find(([name, args]) => name === "Email/set" && args.create);
  if (!emailSet) return null;
  const created = Object.values(emailSet[1].create as Record<string, EmailCreate>);
  return created[0] ?? null;
}

function allParts(email: EmailCreate): BodyPart[] {
  const out: BodyPart[] = [];
  const walk = (part: BodyPart | undefined) => {
    if (!part) return;
    out.push(part);
    part.subParts?.forEach(walk);
  };
  walk(email.bodyStructure);
  email.attachments?.forEach(walk);
  return out;
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^sign in$/i }).first().click();
  await page.locator('[data-tour="email-list"]').waitFor({ timeout: 120_000 });
  for (const name of [/^got it$/i, /^dismiss$/i]) {
    const button = page.getByRole("button", { name }).first();
    // Best effort: a banner may sit under another one or be gone already.
    if (await button.isVisible().catch(() => false)) await button.click({ timeout: 3000 }).catch(() => {});
  }
}

test("a logo in the organisation signature goes out as an inline cid: part", async ({ page }) => {
  // Blob uploads that reached the server; a redirect on the way is the same upload.
  const uploads: string[] = [];
  page.on("requestfinished", async (request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/dev-jmap/upload/")) return;
    const status = (await request.response())?.status() ?? 0;
    if (status >= 200 && status < 300) uploads.push(request.url());
  });

  await signIn(page);
  await page.getByRole("button", { name: /^(compose|new message)$/i }).first().click();
  await page.locator('[data-testid="composer-to"]').first().waitFor();
  // The organisation signature is in the editor, logo included.
  await expect(page.locator('img[alt="ACME logo"]').first()).toBeVisible();

  const to = page.getByPlaceholder("Recipient email addresses").first();
  await to.fill("bob@example.com");
  await to.press("Enter");
  await page.locator('[data-testid="composer-subject"]').first().fill("Logo check");
  // Typed above the signature, which stays as the composer put it in.
  await page.getByRole("textbox", { name: "Message" }).first().click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("Hello Bob");

  const submission = page.waitForRequest((request) => request.url().includes("/api/dev-jmap/api") && submittedEmail(request) !== null);
  // The composer renders a Send button per layout; only one is visible.
  await page.locator('[data-testid="composer-send"]:visible').first().click();
  const email = submittedEmail(await submission)!;

  const html = Object.values(email.bodyValues ?? {}).map((v) => v.value).find((v) => v.includes("<"))!;
  expect(html).toMatch(/Hello Bob[\s\S]*Dev User/);
  expect(html.match(/alt="ACME logo"/g)).toHaveLength(1);
  expect(html).not.toContain("data:image");
  const cid = /<img[^>]*src="cid:([^"]+)"[^>]*alt="ACME logo"/.exec(html)?.[1];
  expect(cid, "the logo refers to a cid:").toBeTruthy();

  const part = allParts(email).find((p) => p.cid === cid);
  expect(part, "a part carries the logo's cid").toMatchObject({ type: "image/png", disposition: "inline" });
  expect(part!.blobId).toMatch(/^blob-upload-/);
  // Uploaded before the message was created; the event may still be on its way.
  await expect.poll(() => uploads.length).toBe(1);
});
