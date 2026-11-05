import { test, expect, type Page, type Request } from "@playwright/test";

/**
 * undust fork: one pass through each patch the fork carries, against the
 * mock JMAP server (see playwright.config.ts). Assertions read the JMAP
 * requests the app sends, so they check what would reach Stalwart.
 */

type MethodCall = [string, Record<string, unknown>, string];

/** Every JMAP method call the page sends, in order. */
function recordJmap(page: Page): MethodCall[] {
  const calls: MethodCall[] = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/dev-jmap/api")) return;
    const body = request.postDataJSON() as { methodCalls?: MethodCall[] } | null;
    calls.push(...(body?.methodCalls ?? []));
  });
  return calls;
}

const callsOf = (calls: MethodCall[], method: string) => calls.filter(([name]) => name === method).map(([, args]) => args);

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^sign in$/i }).first().click();
  await page.locator('[data-tour="email-list"]').waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  for (const name of [/^got it$/i, /^dismiss$/i, /^skip/i, /^close$/i]) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible().catch(() => false)) await button.click({ timeout: 3000 }).catch(() => {});
  }
}

/** Rail navigation: a page.goto after sign-in would drop the session. */
async function openApp(page: Page, app: string) {
  await page.locator(`[data-tour="nav-${app}"]`).first().click();
  await page.waitForTimeout(1500);
}

async function openComposer(page: Page, to: string, subject: string, text: string) {
  await page.getByRole("button", { name: /^(compose|new message)$/i }).first().click();
  const toField = page.getByTestId("composer-to").locator("input").first();
  await toField.waitFor();
  await toField.fill(to);
  await toField.press("Enter");
  await page.getByTestId("composer-subject").fill(subject);
  const editor = page.locator(".ProseMirror").first();
  // The signature is an atom node: a click on it selects it, and typing
  // would replace it. Type in the empty paragraph above it.
  await expect(editor.locator("[data-signature-block-node]")).toHaveCount(1);
  await editor.locator("p").first().click();
  await page.keyboard.type(text);
  return editor;
}

/**
 * The HTML body of the last Email/set create with this subject: the one sent,
 * after any draft autosave.
 */
function createdHtml(calls: MethodCall[], subject: string): { html: string; draft: Record<string, unknown> } {
  for (const args of callsOf(calls, "Email/set").reverse()) {
    for (const draft of Object.values((args.create ?? {}) as Record<string, Record<string, unknown>>)) {
      if (draft.subject !== subject) continue;
      const values = (draft.bodyValues ?? {}) as Record<string, { value: string }>;
      const html = (draft.htmlBody as Array<{ partId: string }> | undefined)?.map((part) => values[part.partId]?.value ?? "").join("") ?? "";
      return { html, draft };
    }
  }
  throw new Error(`no Email/set create for "${subject}"`);
}

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

test("the composer signs a new mail once with the identity's HTML signature", async ({ page }) => {
  const calls = recordJmap(page);
  await signIn(page);
  const editor = await openComposer(page, "bob@example.com", "e2e signature", "Hello Bob");
  await expect(editor.locator("em", { hasText: "Bulwark Webmail Developer" })).toBeVisible();

  await page.locator('[data-testid="composer-send"]:visible').first().click();
  await expect.poll(() => { try { return createdHtml(calls, "e2e signature").html; } catch { return ""; } }).toContain("Hello Bob");

  const { html } = createdHtml(calls, "e2e signature");
  expect(countOf(html, "Bulwark Webmail Developer")).toBe(1);
  expect(html).toContain("<em>Bulwark Webmail Developer</em>");
});

test("a scheduled mail is stamped with its release time, and Send now re-checks the stamp", async ({ page }) => {
  const calls = recordJmap(page);
  await signIn(page);
  await openComposer(page, "bob@example.com", "e2e scheduled", "Later, Bob");

  await page.keyboard.press("Control+Shift+Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button").filter({ hasText: /tomorrow/i }).first().click();

  await expect.poll(() => { try { return typeof createdHtml(calls, "e2e scheduled").draft.sentAt; } catch { return ""; } }).toBe("string");
  const { draft } = createdHtml(calls, "e2e scheduled");
  const holdFor = callsOf(calls, "EmailSubmission/set")
    .flatMap((args) => Object.values((args.create ?? {}) as Record<string, { envelope?: { mailFrom?: { parameters?: Record<string, string> | null } } }>))
    .map((create) => Number(create.envelope?.mailFrom?.parameters?.HOLDFOR))
    .find((seconds) => Number.isFinite(seconds));
  // sched1: the Date the recipient sees and the Sent time are the release time.
  expect(draft.sentAt).toBe(draft.receivedAt);
  expect(Date.parse(draft.sentAt as string)).toBeGreaterThan(Date.now() + 3600_000);
  if (holdFor !== undefined) {
    expect(Math.abs(Date.parse(draft.sentAt as string) - (Date.now() + holdFor * 1000))).toBeLessThan(5 * 60_000);
  }

  // Send now from Scheduled: the reschedule looks at the stamp before it releases.
  await page.getByRole("button", { name: /scheduled/i }).first().click().catch(() => {});
  await page.locator('[data-tour="email-list"] [role="row"]', { hasText: "e2e scheduled" }).first().click();
  const before = calls.length;
  await page.locator('[data-tour="email-viewer"]').getByTitle(/^send now$/i).first().click();
  await expect.poll(() => callsOf(calls.slice(before), "EmailSubmission/set").some((args) => !!args.create)).toBe(true);
  const probe = callsOf(calls.slice(before), "Email/get").find((args) => (args.properties as string[] | undefined)?.includes("sentAt") && (args.properties as string[]).includes("blobId"));
  expect(probe).toBeTruthy();
});

test("an invitation awaiting a reply is hatched in the calendar", async ({ page }) => {
  // The mock lists the user as organizer; make them an attendee who has not replied.
  await page.route("**/api/dev-jmap/api", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const [name, result] of body.methodResponses ?? []) {
      if (name !== "CalendarEvent/get") continue;
      for (const event of result.list ?? []) {
        const participants = event.participants as Record<string, Record<string, unknown>> | undefined;
        if (!participants || event.title !== "Daily Standup") continue;
        for (const p of Object.values(participants)) {
          const me = String((p.sendTo as { imip?: string } | undefined)?.imip ?? "").includes("dev@localhost");
          p.roles = me ? { attendee: true } : { owner: true, attendee: true };
          p.kind = "individual";
          if (me) p.participationStatus = "needs-action";
        }
        event.replyTo = { imip: "mailto:lars.johansson@fjord-systems.example" };
      }
    }
    await route.fulfill({ response, json: body });
  });
  await signIn(page);
  await openApp(page, "calendar");

  const pending = page.locator('[aria-label*="Awaiting reply"]').first();
  await expect(pending).toBeVisible({ timeout: 20_000 });
  const backgroundImage = await pending.evaluate((el) => (el as HTMLElement).style.backgroundImage || getComputedStyle(el).backgroundImage);
  expect(backgroundImage).toContain("repeating-linear-gradient");
});

test("a custom key replaces the built-in one for a mail action", async ({ page }) => {
  const calls = recordJmap(page);
  await signIn(page);
  await openApp(page, "settings");
  await page.getByRole("button", { name: /^general$/i }).first().click();
  const row = page.getByTestId("shortcut-row-toggle-star");
  await row.scrollIntoViewIfNeeded();
  await row.getByRole("button", { name: /^change$/i }).click();
  await row.locator("input").press("Control+e");
  await expect(row.locator("kbd")).toHaveText(["Ctrl + E"]);

  await openApp(page, "mail");
  await page.locator('[data-tour="email-list"] [role="row"]').first().click();
  await page.locator('[data-tour="email-viewer"]').waitFor();
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});

  const starUpdates = () => callsOf(calls, "Email/set").filter((args) =>
    Object.values((args.update ?? {}) as Record<string, Record<string, unknown>>).some((patch) => "keywords/$flagged" in patch));
  await page.keyboard.press("s");
  await page.waitForTimeout(800);
  expect(starUpdates()).toHaveLength(0);
  await page.keyboard.press("Control+e");
  await expect.poll(() => starUpdates().length).toBe(1);
});

test("the event form reserves an undust visio room", async ({ page }) => {
  await page.route("https://ops.undust.co/api/calendar/meetings/reserve", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "http://localhost:3152", "access-control-allow-credentials": "true" },
    body: JSON.stringify({ room_name: "e2e-room", organizer_email: "dev@localhost", url: "https://ops.undust.co/meet/e2e-room" }),
  }));
  await signIn(page);
  await openApp(page, "calendar");
  await page.getByRole("button", { name: /^(new event|create event|create|new)$/i }).first().click();
  const generate = page.getByTestId("undust-meet-generate");
  await expect(generate).toBeVisible();
  await page.getByPlaceholder("https://meet.example.com/...").waitFor();
  await generate.click();
  await expect(page.getByPlaceholder("https://meet.example.com/...")).toHaveValue("https://ops.undust.co/meet/e2e-room");
});
