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

  // Send now from Scheduled: the message goes out re-stamped with the time
  // of now (sched2), as a copy imported before the original is canceled.
  const importedIds: string[] = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/api/dev-jmap/api") || response.request().method() !== "POST") return;
    const body = await response.json().catch(() => null) as { methodResponses?: MethodCall[] } | null;
    for (const [name, result] of body?.methodResponses ?? []) {
      if (name === "Email/import") importedIds.push(...Object.values((result.created ?? {}) as Record<string, { id: string }>).map((c) => c.id));
    }
  });
  await page.getByRole("button", { name: /scheduled/i }).first().click().catch(() => {});
  await page.locator('[data-tour="email-list"] [role="row"]', { hasText: "e2e scheduled" }).first().click();
  const before = calls.length;
  const clickedAt = Date.now();
  await page.locator('[data-tour="email-viewer"]').getByTitle(/^send now$/i).first().click();
  await expect.poll(() => callsOf(calls.slice(before), "EmailSubmission/set").some((args) => !!args.create)).toBe(true);

  const sent = calls.slice(before);
  const importAt = sent.findIndex(([name]) => name === "Email/import");
  const cancelAt = sent.findIndex(([name, args]) => name === "EmailSubmission/set" && !!args.update);
  expect(importAt).toBeGreaterThan(-1);
  expect(importAt).toBeLessThan(cancelAt);
  // The replacement submission sends that copy.
  await expect.poll(() => importedIds.length).toBe(1);
  const replacement = callsOf(sent, "EmailSubmission/set").map((args) => Object.values((args.create ?? {}) as Record<string, { emailId: string }>)[0]).find(Boolean);
  expect(replacement?.emailId).toBe(importedIds[0]);
  // The copy's Date header, as the server read it from the imported raw
  // message, is the time of the click, not tomorrow's release time.
  const answer = await page.request.post("/api/dev-jmap/api", {
    data: { methodCalls: [["Email/get", { accountId: "dev-account-001", ids: [importedIds[0]], properties: ["sentAt", "subject"] }, "c0"]] },
  });
  const copy = ((await answer.json()) as { methodResponses: MethodCall[] }).methodResponses[0][1].list as Array<{ sentAt: string; subject: string }>;
  expect(copy[0].subject).toBe("e2e scheduled");
  expect(Math.abs(Date.parse(copy[0].sentAt) - clickedAt)).toBeLessThan(2 * 60_000);
  expect(Date.parse(copy[0].sentAt)).toBeLessThan(Date.parse(draft.sentAt as string) - 3600_000);
});

test("an invitation awaiting a reply is marked in the calendar (upstream 1.21 marker, replaces our rsvp1 hatch)", async ({ page }) => {
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

  const pending = page.locator('[data-reply-state="needs-action"]').first();
  await expect(pending).toBeVisible({ timeout: 20_000 });
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

/** What the page's clipboard holds now, as text and as HTML. */
async function readClipboard(page: Page): Promise<{ text: string; html: string }> {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    let text = "";
    let html = "";
    for (const item of items) {
      if (item.types.includes("text/plain")) text += await (await item.getType("text/plain")).text();
      if (item.types.includes("text/html")) html += await (await item.getType("text/html")).text();
    }
    return { text, html };
  });
}

test("the composer's signature can be selected and copied, and still unlocks on a double-click (sig3)", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const calls = recordJmap(page);
  await signIn(page);
  const editor = await openComposer(page, "bob@example.com", "e2e signature copy", "Hello Bob");
  const island = editor.locator(".signature-block-island");
  const line = island.locator("em", { hasText: "Bulwark Webmail Developer" });
  await expect(line).toBeVisible();

  // A drag across a line of the signature selects its text, it no longer
  // takes the whole block, and Copy copies it.
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const selected = await island.evaluate((el) => {
    const root = el.shadowRoot as ShadowRoot & { getSelection?: () => Selection | null };
    return (root.getSelection?.() ?? document.getSelection())?.toString() ?? "";
  });
  expect(selected).toContain("Bulwark Webmail");
  await page.keyboard.press("Control+c");
  await expect.poll(async () => (await readClipboard(page)).text).toContain("Bulwark Webmail");
  // Selecting is not an edit: the block is still there, locked, and the
  // editor holds it selected as a whole.
  await expect(editor.locator("[data-signature-block-node]")).toHaveCount(1);
  await expect(island).toHaveClass(/ProseMirror-selectednode/);
  // Backspace there removes the whole signature, as it did on a
  // click-selected block; Undo brings it back.
  await page.keyboard.press("Backspace");
  await expect(editor.locator("[data-signature-block-node]")).toHaveCount(0);
  await expect(editor.getByText("Hello Bob")).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(editor.locator("[data-signature-block-node]")).toHaveCount(1);

  const dragAcross = async () => {
    const b = (await island.locator("em").boundingBox())!;
    await page.mouse.move(b.x + 1, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  // A key after a selection in the signature is the editor's again: Enter
  // opens a line after the block and what follows is typed there.
  await dragAcross();
  await page.keyboard.press("Enter");
  await page.keyboard.type("After the signature");
  await expect(editor.locator("p", { hasText: "After the signature" })).toHaveCount(1);
  await expect(editor.locator("[data-signature-block-node]")).toHaveCount(1);
  // Ctrl+A from there selects the whole body, visibly, and copies it all.
  await dragAcross();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await expect.poll(async () => (await readClipboard(page)).text).toContain("After the signature");
  expect((await readClipboard(page)).text).toContain("Bulwark Webmail Developer");

  // Ctrl+A / Ctrl+C of the body takes the signature along, text and HTML.
  await editor.locator("p").first().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await expect.poll(async () => (await readClipboard(page)).text).toContain("Hello Bob");
  const all = await readClipboard(page);
  expect(all.text).toContain("Dev User");
  expect(all.text).toContain("Bulwark Webmail Developer");
  expect(all.html).toContain("<em>Bulwark Webmail Developer</em>");

  // The double-click unlock (#862) still turns it into editable text.
  await editor.locator("p").first().click();
  await island.locator("em").dblclick();
  await expect(editor.locator("[data-signature-block-node]")).toHaveCount(0);
  await expect(editor.getByText("Bulwark Webmail Developer")).toBeVisible();

  await page.locator('[data-testid="composer-send"]:visible').first().click();
  await expect.poll(() => { try { return createdHtml(calls, "e2e signature copy").html; } catch { return ""; } }).toContain("Hello Bob");
  const { html } = createdHtml(calls, "e2e signature copy");
  expect(countOf(html, "Bulwark Webmail Developer")).toBe(1);
});

test("a re-opened draft written elsewhere goes out with its author's signature only, under a locked one (sig3)", async ({ page }) => {
  const LOCKED = "ACME e2e locked";
  const HAND = "Signed by hand, e2e";
  // The admin locks an organisation signature.
  await page.route("**/api/admin/policy", async (route) => {
    const response = await route.fetch();
    const policy = await response.json().catch(() => ({})) as Record<string, Record<string, unknown> | undefined>;
    policy.restrictions = { ...(policy.restrictions ?? {}), signature: { locked: true } };
    policy.organisation = { ...(policy.organisation ?? {}), signature: { html: `<p>{name}<br>${LOCKED}</p>`, text: `{name}\n${LOCKED}`, fields: [] } };
    await route.fulfill({ response, json: policy });
  });
  // The seeded draft "Standup notes" comes back as an agent drops one over
  // JMAP: HTML, signed its own way, no signature markers.
  await page.route("**/api/dev-jmap/api", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const [name, result] of body.methodResponses ?? []) {
      if (name !== "Email/get") continue;
      for (const email of result.list ?? []) {
        if (email.id !== "email-009") continue;
        email.htmlBody = [{ partId: "h1", blobId: "blob-e2e-h1", size: 120, type: "text/html" }];
        email.textBody = [{ partId: "t1", blobId: "blob-e2e-t1", size: 60, type: "text/plain" }];
        email.bodyValues = {
          ...(email.bodyValues ?? {}),
          h1: { value: `<p>Standup: all good.</p><p>-- <br>Dev<br>${HAND}</p>` },
          t1: { value: `Standup: all good.\n\n-- \nDev\n${HAND}` },
        };
      }
    }
    await route.fulfill({ response, json: body });
  });
  const calls = recordJmap(page);
  await signIn(page);

  // The lock is on: a new mail is signed with it.
  await openComposer(page, "bob@example.com", "e2e locked new", "Hello Bob");
  await page.locator('[data-testid="composer-send"]:visible').first().click();
  await expect.poll(() => { try { return createdHtml(calls, "e2e locked new").html; } catch { return ""; } }).toContain("Hello Bob");
  expect(countOf(createdHtml(calls, "e2e locked new").html, LOCKED)).toBe(1);

  // The external draft: no second signature in the composer, none at send.
  await page.locator('[data-testid="folder-row"][data-folder-role="drafts"]').first().click();
  await page.locator('[data-tour="email-list"] [role="row"]', { hasText: "Standup notes" }).first().click();
  await page.getByTestId("edit-draft").first().click();
  const editor = page.locator(".ProseMirror").first();
  await expect(editor.getByText(HAND)).toBeVisible();
  await expect(editor.locator("[data-signature-block-node]")).toHaveCount(0);
  await page.locator('[data-testid="composer-send"]:visible').first().click();
  await expect.poll(() => { try { return createdHtml(calls, "Standup notes").html; } catch { return ""; } }).toContain(HAND);
  const sent = createdHtml(calls, "Standup notes");
  expect(countOf(sent.html, HAND)).toBe(1);
  expect(countOf(sent.html, LOCKED)).toBe(0);
  const values = (sent.draft.bodyValues ?? {}) as Record<string, { value: string }>;
  const text = ((sent.draft.textBody as Array<{ partId: string }> | undefined) ?? []).map((part) => values[part.partId]?.value ?? "").join("");
  expect(countOf(text, LOCKED)).toBe(0);
});
