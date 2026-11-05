import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JMAPClient, rfc5322Date, withDateHeader } from '../jmap/client';

// A held message carries its release time as Date (scheduledReleaseDate).
// "Send now" on a mail due tomorrow reused that Email and went out dated in
// the future (why upstream closed #1191): a reschedule that moves the release
// re-stamps a copy of the message instead.

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const text = (raw: Uint8Array) => Array.from(raw, (b) => String.fromCharCode(b)).join('');

describe('withDateHeader', () => {
  const release = new Date('2026-11-05T06:45:00Z');

  it('writes an RFC 5322 date in UTC', () => {
    expect(rfc5322Date(release)).toBe('Thu, 05 Nov 2026 06:45:00 +0000');
  });

  it('replaces the Date header, folded lines included, and leaves the rest byte for byte', () => {
    const raw = bytes('From: a@example.com\r\nDate: Wed, 04 Nov 2026\r\n 23:11:00 +0100\r\nSubject: =?UTF-8?Q?caf=C3=A9?=\r\n\r\nDate: not a header\r\n\x82\xe9\xff');
    const out = text(withDateHeader(raw, release));
    expect(out).toBe('From: a@example.com\r\nDate: Thu, 05 Nov 2026 06:45:00 +0000\r\nSubject: =?UTF-8?Q?caf=C3=A9?=\r\n\r\nDate: not a header\r\n\x82\xe9\xff');
  });

  it('adds a Date header when there is none', () => {
    const out = text(withDateHeader(bytes('Subject: x\n\nbody'), release));
    expect(out).toBe('Date: Thu, 05 Nov 2026 06:45:00 +0000\nSubject: x\n\nbody');
  });
});

describe('rescheduleEmailSubmission re-stamps the held message', () => {
  beforeEach(() => vi.restoreAllMocks());

  const TOMORROW = Date.now() + 20 * 3600_000;

  interface ServerOptions {
    /** The server refuses the Email/import of the copy. */
    importFails?: boolean;
    /** The server refuses the replacement submission (invalidProperties). */
    replacementRefused?: boolean;
    /** Email/set destroy fails. */
    destroyFails?: boolean;
    /** The cancel is refused (cannotUnsend) while the original is still pending. */
    cancelRefused?: boolean;
  }

  function scriptServer(storedSentAt: string, options: ServerOptions = {}) {
    const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
    Object.assign(client, {
      apiUrl: 'https://jmap.example.com/api',
      accountId: 'account-1',
      username: 'user@example.com',
      capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {}, 'urn:ietf:params:jmap:submission': {} },
      session: {
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account-1', 'urn:ietf:params:jmap:submission': 'account-1' },
        accounts: {
          'account-1': {
            accountCapabilities: {
              'urn:ietf:params:jmap:mail': {},
              'urn:ietf:params:jmap:submission': { maxDelayedSend: 86400 * 2, submissionExtensions: { FUTURERELEASE: true } },
            },
          },
        },
      },
    });
    vi.spyOn(client, 'getMailboxes').mockResolvedValue([
      { id: 'mb-drafts', name: 'Drafts', role: 'drafts' },
      { id: 'mb-sent', name: 'Sent', role: 'sent' },
    ] as never);
    const uploaded: Uint8Array[] = [];
    vi.spyOn(client, 'fetchBlobArrayBuffer').mockResolvedValue(
      bytes(`Date: ${rfc5322Date(new Date(storedSentAt))}\r\nSubject: hi\r\n\r\nbody`).buffer as ArrayBuffer,
    );
    vi.spyOn(client, 'uploadBlob').mockImplementation(async (file: File) => {
      uploaded.push(new Uint8Array(await file.arrayBuffer()));
      return { blobId: 'blob-restamped', size: file.size, type: file.type };
    });
    // What the server holds: the original submission's state, and each copy imported.
    const state = { undoStatus: 'pending' as 'pending' | 'canceled', copies: 0 };
    const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
    vi.spyOn(client as unknown as { request: JMAPClient['request'] }, 'request').mockImplementation(async (methodCalls) => {
      const [method, args] = methodCalls[0] as unknown as [string, Record<string, unknown>];
      calls.push({ method, args });
      switch (method) {
        case 'Identity/get':
          return { methodResponses: [[method, { list: [{ id: 'identity-1', email: 'user@example.com' }] }, '0']] };
        case 'EmailSubmission/get':
          return { methodResponses: [[method, { list: [{ id: 'sub-old', identityId: 'identity-1', sendAt: storedSentAt, undoStatus: state.undoStatus, envelope: { rcptTo: [{ email: 'rcpt@example.com' }] } }] }, '0']] };
        case 'Email/get':
          return { methodResponses: [[method, { list: [{ id: 'email-1', sentAt: storedSentAt, blobId: 'blob-1', mailboxIds: { 'mb-sent': true }, keywords: { $seen: true } }] }, '0']] };
        case 'Email/import':
          if (options.importFails) return { methodResponses: [[method, { notCreated: { restamped: { type: 'invalidEmail' } } }, '0']] };
          state.copies += 1;
          return { methodResponses: [[method, { created: { restamped: { id: `copy-${state.copies}` } } }, '0']] };
        case 'Email/set':
          if (options.destroyFails) return { methodResponses: [[method, { notDestroyed: Object.fromEntries((args.destroy as string[]).map((id) => [id, { type: 'forbidden' }])) }, '0']] };
          return { methodResponses: [[method, { destroyed: args.destroy ?? [] }, '0']] };
        case 'EmailSubmission/set':
          if (args.update) {
            if (options.cancelRefused || state.undoStatus === 'canceled') {
              return { methodResponses: [[method, { notUpdated: { 'sub-old': { type: 'cannotUnsend' } } }, '0']] };
            }
            state.undoStatus = 'canceled';
            return { methodResponses: [[method, { updated: { 'sub-old': null } }, '0']] };
          }
          if (args.destroy) return { methodResponses: [[method, { destroyed: args.destroy }, '0']] };
          if (options.replacementRefused && (args.create as Record<string, { emailId: string }>).replacement.emailId !== 'email-1') {
            return { methodResponses: [[method, { notCreated: { replacement: { type: 'invalidProperties', properties: ['emailId'] } } }, '0']] };
          }
          return { methodResponses: [[method, { created: { replacement: { id: 'sub-new', sendAt: new Date().toISOString() } } }, '0']] };
      }
      throw new Error(`unexpected call ${method}`);
    });
    const destroyed = () => calls.filter((c) => c.method === 'Email/set' && c.args.destroy).flatMap((c) => c.args.destroy as string[]);
    const creates = () => calls.filter((c) => c.method === 'EmailSubmission/set' && c.args.create)
      .map((c) => (c.args.create as Record<string, { emailId: string }>).replacement.emailId);
    return { client, calls, uploaded, state, destroyed, creates };
  }

  it('sends a message scheduled for tomorrow now with the date of now, not of tomorrow', async () => {
    const { client, calls, uploaded } = scriptServer(new Date(TOMORROW).toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const before = Date.now();

    const result = await client.rescheduleEmailSubmission('sub-old', 'email-1', 'identity-1', new Date(Date.now() + 1000).toISOString());

    const header = /^Date: (.*)\r$/m.exec(text(uploaded[0]))![1];
    expect(Math.abs(Date.parse(header) - before)).toBeLessThan(10_000);
    const imported = calls.find((c) => c.method === 'Email/import')!.args.emails as Record<string, Record<string, unknown>>;
    expect(imported.restamped).toMatchObject({ blobId: 'blob-restamped', mailboxIds: { 'mb-drafts': true }, keywords: { $seen: true, $draft: true } });
    expect(Math.abs(Date.parse(imported.restamped.receivedAt as string) - before)).toBeLessThan(10_000);
    const create = calls.find((c) => c.method === 'EmailSubmission/set' && c.args.create)!.args.create as Record<string, { emailId: string }>;
    expect(create.replacement.emailId).toBe('copy-1');
    // The copy replaces the old message.
    expect(calls.find((c) => c.method === 'Email/set' && c.args.destroy)?.args.destroy).toEqual(['email-1']);
    // The copy exists before the original is canceled.
    const importAt = calls.findIndex((c) => c.method === 'Email/import');
    const cancelAt = calls.findIndex((c) => c.method === 'EmailSubmission/set' && c.args.update);
    expect(importAt).toBeGreaterThan(-1);
    expect(importAt).toBeLessThan(cancelAt);
    expect(result).toMatchObject({ scheduled: true, emailId: 'copy-1', emailSubmissionId: 'sub-new' });
  });

  it('keeps the message when the release moves by seconds (Send now in the undo window)', async () => {
    const soon = new Date(Date.now() + 10_000).toISOString();
    const { client, calls } = scriptServer(soon);

    const result = await client.rescheduleEmailSubmission('sub-old', 'email-1', 'identity-1', new Date(Date.now() + 1000).toISOString());

    expect(calls.some((c) => c.method === 'Email/import')).toBe(false);
    expect(calls.some((c) => c.method === 'Email/set' && c.args.destroy)).toBe(false);
    expect(result.emailId).toBe('email-1');
  });

  const tomorrow = () => new Date(TOMORROW).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const now = () => new Date(Date.now() + 1000).toISOString();

  it('changes nothing when the cancel is refused, and takes its copy back out', async () => {
    const { client, destroyed, creates, state } = scriptServer(tomorrow(), { cancelRefused: true });

    await expect(client.rescheduleEmailSubmission('sub-old', 'email-1', 'identity-1', now())).rejects.toThrow('cannotUnsend');

    expect(state.undoStatus).toBe('pending');
    expect(destroyed()).toEqual(['copy-1']);
    expect(creates()).toEqual([]);
  });

  it('puts the original back and removes the copy when the server refuses the replacement', async () => {
    const { client, destroyed, creates } = scriptServer(tomorrow(), { replacementRefused: true });

    await expect(client.rescheduleEmailSubmission('sub-old', 'email-1', 'identity-1', now())).rejects.toMatchObject({ name: 'RescheduleRestoredError' });

    expect(creates()).toEqual(['copy-1', 'email-1']);
    expect(destroyed()).toEqual(['copy-1']);
  });

  it('releases the original unchanged when the copy cannot be imported', async () => {
    const { client, destroyed, creates } = scriptServer(tomorrow(), { importFails: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await client.rescheduleEmailSubmission('sub-old', 'email-1', 'identity-1', now());

    expect(creates()).toEqual(['email-1']);
    expect(destroyed()).toEqual([]);
    expect(result).toMatchObject({ scheduled: true, emailId: 'email-1', emailSubmissionId: 'sub-new' });
  });

  it('still reports the release when the replaced original cannot be removed', async () => {
    const { client, creates } = scriptServer(tomorrow(), { destroyFails: true });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await client.rescheduleEmailSubmission('sub-old', 'email-1', 'identity-1', now());

    expect(creates()).toEqual(['copy-1']);
    expect(result).toMatchObject({ scheduled: true, emailId: 'copy-1', emailSubmissionId: 'sub-new' });
    expect(logged).toHaveBeenCalledWith('Failed to remove the message the re-stamped copy replaced:', expect.anything());
  });

  it('sends once on a double click of Send now: the second finds the original canceled and removes its copy', async () => {
    const { client, destroyed, creates } = scriptServer(tomorrow());

    const [first, second] = await Promise.allSettled([
      client.rescheduleEmailSubmission('sub-old', 'email-1', 'identity-1', now()),
      client.rescheduleEmailSubmission('sub-old', 'email-1', 'identity-1', now()),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const lost = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ name: 'NoLongerScheduledError' });
    expect(creates()).toHaveLength(1);
    const kept = creates()[0];
    // The loser's copy goes, and the winner's replaced original.
    expect(destroyed().sort()).toEqual(['copy-1', 'copy-2', 'email-1'].filter((id) => id !== kept).sort());
  });
});
