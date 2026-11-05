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

// next dev compiles the app page and the mock server's route on first use;
// until then a request can come back empty. Ask for both until they answer.
test.beforeAll(async ({ request }) => {
  test.setTimeout(480_000);
  for (const path of ["/", "/api/dev-jmap/.well-known/jmap"]) {
    await expect.poll(async () => {
      try {
        const status = (await request.get(path, { timeout: 240_000, maxRedirects: 0 })).status();
        return status < 500;
      } catch {
        return false;
      }
    }, { message: `${path} answers`, timeout: 470_000, intervals: [2_000] }).toBe(true);
  }
});

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
  // Typed in the empty first paragraph, above the signature, which stays in
  // the editor as the composer put it in.
  const editor = page.getByRole("textbox", { name: "Message" }).first();
  await editor.locator("p").first().click();
  await page.keyboard.type("Hello Bob");
  await expect(editor.locator("[data-signature-block-node] img[alt='ACME logo']")).toHaveCount(1);

  const submission = page.waitForRequest((request) => request.url().includes("/api/dev-jmap/api") && submittedEmail(request) !== null);
  // The composer renders a Send button per layout; only one is visible.
  await page.locator('[data-testid="composer-send"]:visible').first().click();
  const email = submittedEmail(await submission)!;

  const html = Object.values(email.bodyValues ?? {}).map((v) => v.value).find((v) => v.includes("<"))!;
  expect(html).not.toContain("data:image");
  // What the sent HTML holds, read with the browser's parser.
  const shape = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const greeting = Array.from(doc.querySelectorAll("p")).find((p) => p.textContent?.includes("Hello Bob"));
    const logos = Array.from(doc.querySelectorAll("img[alt='ACME logo']"));
    return {
      greetingInSignature: greeting ? !!greeting.closest("[data-signature-block], [data-signature-block-node]") : null,
      logos: logos.map((img) => ({ src: img.getAttribute("src") ?? "", inSignatureNode: !!img.closest("[data-signature-block-node]") })),
    };
  }, html);
  expect(shape.greetingInSignature, "Hello Bob is in its own paragraph, outside the signature").toBe(false);
  // The signature the editor kept is the one that goes; the finaliser adds no second copy.
  expect(shape.logos).toHaveLength(1);
  expect(shape.logos[0].inSignatureNode).toBe(true);
  const cid = /^cid:(.+)$/.exec(shape.logos[0].src)?.[1];
  expect(cid, "the logo refers to a cid:").toBeTruthy();

  const part = allParts(email).find((p) => p.cid === cid);
  expect(part, "a part carries the logo's cid").toMatchObject({ type: "image/png", disposition: "inline" });
  expect(part!.blobId).toMatch(/^blob-upload-/);
  // Uploaded before the message was created; the event may still be on its way.
  await expect.poll(() => uploads.length).toBe(1);
});
