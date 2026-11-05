import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { EmailComposer } from '../email-composer';
import { useAuthStore } from '@/stores/auth-store';

// ─── Heavy component mocks (mirrors composer-draft-attachments.test.tsx) ──────

vi.mock('@/components/email/rich-text-editor', () => ({
  RichTextEditor: () => React.createElement('div', { 'data-testid': 'rich-text-editor' }),
}));

vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/components/identity/sub-address-helper', () => ({ SubAddressHelper: () => null }));
vi.mock('@/components/templates/template-picker', () => ({ TemplatePicker: () => null }));
vi.mock('@/components/templates/template-form', () => ({ TemplateForm: () => null }));
vi.mock('@/components/files/file-preview-modal', () => ({ FilePreviewModal: () => null }));
vi.mock('@/hooks/use-focus-trap', () => ({ useFocusTrap: () => ({ current: null }) }));
vi.mock('@/hooks/use-pro-multi-account-identities', () => ({
  useProMultiAccountIdentities: () => ({ enabled: false, groups: [], allIdentities: [] }),
  stripCrossAccountIdentityPrefix: (id: string) => ({ localAccountId: null, rawId: id }),
}));

vi.mock('@/stores/auth-store', () => {
  const state = {
    client: null,
    identities: [],
    primaryIdentity: null,
    isAuthenticated: false,
    isDemoMode: false,
    activeAccountId: null,
    connectionLost: false,
    getClientForAccount: () => undefined,
    getAllConnectedClients: () => new Map(),
    syncIdentities: () => {},
    refreshIdentities: async () => {},
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useAuthStore: hook };
});

vi.mock('@/stores/identity-store', () => {
  const state = {
    identities: [{ id: 'id-me', email: 'me@example.com', name: 'Me' }],
    defaultIdentityId: 'id-me',
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useIdentityStore: hook };
});

vi.mock('@/stores/account-store', () => {
  const state = { accounts: [], getAccountById: () => undefined };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useAccountStore: hook };
});

vi.mock('@/stores/email-store', () => {
  const state = { draftSaveEnabled: false, sendRawEmail: async () => ({ sent: true }) };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useEmailStore: hook };
});

vi.mock('@/stores/settings-store', () => {
  const state = {
    timeFormat: '24h',
    plainTextMode: false,
    subAddressDelimiter: '+',
    autoSelectReplyIdentity: true,
    attachmentReminderEnabled: false,
    attachmentReminderKeywords: [],
    emptySubjectWarningEnabled: true,
    sendDelaySeconds: 0,
    externalContentPolicy: 'block',
    isSenderTrusted: () => false,
    signaturePosition: 'above_quote',
    signatureSeparatorEnabled: false,
    requestReadReceiptDefault: false,
    addTrustedSender: () => {},
    trustedSendersAddressBook: null,
    updateSetting: () => {},
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useSettingsStore: hook };
});

vi.mock('@/stores/contact-store', () => {
  const state = {
    contacts: [],
    getAutocomplete: async () => [],
    addToTrustedSendersBook: async () => {},
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useContactStore: hook };
});

vi.mock('@/stores/template-store', () => {
  const state = { templates: [], addTemplate: async () => {} };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useTemplateStore: hook };
});

vi.mock('@/stores/toast-store', () => ({
  toast: { info: () => {}, error: () => {}, success: () => {} },
}));

vi.mock('@/lib/plugin-hooks', () => ({
  identityHooks: {
    onSignatureRender: { size: 0, transform: async (value: unknown) => value },
    onIdentitySelect: { size: 0, emit: async () => {} },
  },
  templateHooks: {
    onTemplateRender: { size: 0, transform: async (value: unknown) => value },
    onTemplateApply: { size: 0, emit: async () => {} },
  },
  emailHooks: {
    onComposerOpen: { call: async () => [] },
    onRecipientChange: { call: async () => [] },
    getRecipientSuggestions: { call: async () => [] },
    onRecipientChipsChange: { transform: async (chips: unknown) => chips },
    onDraftChange: { emit: () => {} },
    onBeforeDraftAutoSave: { transform: async (draft: unknown) => draft },
    onBeforeEmailSend: { intercept: async () => true, interceptOutcome: async () => 'allowed' },
    onComposeSend: { takeOver: async () => 'default' },
    onTransformOutgoingEmail: { transform: async (email: unknown) => email },
  },
  contactHooks: {
    search: { call: async () => [] },
    onProvideRecipientSuggestions: { transform: async (initial: unknown) => initial },
  },
}));

vi.mock('@/lib/email-sanitization', () => ({
  sanitizeSignatureHtml: (v: string) => v,
  sanitizeEmailHtml: (v: string) => v,
  parseHtmlSafely: (html: string) => new DOMParser().parseFromString(html, 'text/html'),
}));

vi.mock('@/lib/email-threading', () => ({
  computeReplyThreadingHeaders: () => ({ inReplyTo: [], references: [] }),
}));
vi.mock('@/lib/signature-utils', () => ({
  appendPlainTextSignature: (body: string) => body,
  getPlainTextSignature: () => '',
  plainTextBodyHasSignature: () => false,
  plainTextBodyWithoutSignature: (body: string) => body,
}));
vi.mock('@/lib/sub-addressing', () => ({ generateSubAddress: () => '' }));
vi.mock('@/lib/debug', () => ({ debug: { log: () => {}, warn: () => {}, error: () => {} } }));
vi.mock('@/lib/template-utils', () => ({ substitutePlaceholders: (s: string) => s }));

// ─── Tests ────────────────────────────────────────────────────────────────────

/**
 * Senders may declare `Content-ID: <logo123@sender>` (angle brackets kept)
 * while the body always references it bracket-free as `src="cid:logo123@sender"`.
 * The viewers already normalize both sides before matching; the reply/forward
 * hydration path didn't, so any such image silently stayed a blank placeholder
 * in the composer and was dropped from the outgoing message on send.
 */
describe('reply/forward inline image cid normalization', () => {
  afterEach(() => {
    useAuthStore.setState({ client: null });
    vi.clearAllMocks();
  });

  const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;

  function mockClient() {
    const fetchBlobArrayBuffer = vi.fn().mockResolvedValue(PNG_MAGIC);
    const uploadBlob = vi.fn(async (file: File) => ({ blobId: `blob-${file.name}`, size: file.size, type: file.type }));
    useAuthStore.setState({
      client: {
        fetchBlobArrayBuffer,
        uploadBlob,
        hasDelayedSend: () => false,
        supportsPrincipals: () => false,
        getMaxDelayedSend: () => 0,
      } as never,
    });
    return { fetchBlobArrayBuffer, uploadBlob };
  }

  it('sends a reply with the image inlined by cid, not duplicated as a regular attachment', async () => {
    const { fetchBlobArrayBuffer } = mockClient();
    const onSend = vi.fn();

    render(
      <EmailComposer
        mode="reply"
        onSend={onSend}
        replyTo={{
          from: [{ email: 'sender@example.com', name: 'Sender' }],
          subject: 'Hello',
          htmlBody: '<p>Hi</p><img src="cid:logo123@sender">',
          quoteHeaderHtml: 'On X, Sender wrote:',
          attachments: [
            { blobId: 'blob-1', name: 'logo.png', type: 'image/png', size: 100, cid: '<logo123@sender>' },
          ],
        }}
        onClose={vi.fn()}
      />
    );

    // Hydration: the placeholder gets swapped for the fetched blob's data URL.
    await waitFor(() => expect(fetchBlobArrayBuffer).toHaveBeenCalledWith('blob-1', 'logo.png', 'image/png'));

    // Reply auto-fills "to" from replyTo.from, so Send is reachable immediately.
    fireEvent.click(screen.getAllByTestId('composer-send')[0]);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));

    const sent = onSend.mock.calls[0][0] as { htmlBody?: string; attachments?: Array<{ cid?: string; blobId: string; disposition?: string }> };
    // The data URL must have been rewritten back to a cid: reference for sending.
    expect(sent.htmlBody).toContain('cid:logo123@sender');
    expect(sent.htmlBody).not.toContain('data:image');
    // Exactly one attachment for the one image - a bracket-mismatch used to
    // mean it was never matched at all; matching on both regular AND inline
    // paths would instead send the same blob twice (see forward test below).
    expect(sent.attachments).toEqual([
      expect.objectContaining({ blobId: 'blob-1', cid: 'logo123@sender', disposition: 'inline' }),
    ]);
  });

  it('does not duplicate a forwarded inline image (declared octet-stream, no disposition) as a regular attachment', async () => {
    const { fetchBlobArrayBuffer } = mockClient();
    const onSend = vi.fn();

    render(
      <EmailComposer
        mode="forward"
        onSend={onSend}
        replyTo={{
          from: [{ email: 'sender@example.com', name: 'Sender' }],
          subject: 'Hello',
          htmlBody: '<p>Hi</p><img src="cid:logo123@sender">',
          quoteHeaderHtml: 'Forwarded message',
          // Foxmail-style part (#543): no inline disposition, generic type -
          // only the cid: body reference marks it as embedded.
          attachments: [
            { blobId: 'blob-1', name: 'logo.png', type: 'application/octet-stream', size: 100, cid: '<logo123@sender>' },
          ],
        }}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(fetchBlobArrayBuffer).toHaveBeenCalledWith('blob-1', 'logo.png', 'application/octet-stream'));

    // The forward attachment-list filter must have recognized blob-1 as
    // embedded and kept it out of the regular attachment chips.
    expect(screen.queryByText('logo.png')).not.toBeInTheDocument();

    // Forward doesn't auto-fill "to" - add a recipient so Send is reachable.
    // A trailing delimiter is needed: a bare single-address paste is left as
    // uncommitted input text rather than immediately chipped.
    fireEvent.paste(screen.getByPlaceholderText('to_placeholder'), {
      clipboardData: { getData: () => 'bob@example.com;' },
    });

    fireEvent.click(screen.getAllByTestId('composer-send')[0]);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));

    const sent = onSend.mock.calls[0][0] as { attachments?: Array<{ cid?: string; blobId: string }> };
    // Same blobId must appear exactly once, as the re-typed inline part -
    // never also as a plain attachment (that would send it twice).
    expect(sent.attachments).toEqual([
      expect.objectContaining({ blobId: 'blob-1', cid: 'logo123@sender' }),
    ]);
  });
  it('sends a quoted image whose part is missing without uploading its stand-in', async () => {
    const { uploadBlob } = mockClient();
    const onSend = vi.fn();

    render(
      <EmailComposer
        mode="reply"
        onSend={onSend}
        replyTo={{
          from: [{ email: 'sender@example.com', name: 'Sender' }],
          subject: 'Hello',
          // The original refers to a part it doesn't carry: the composer
          // shows a transparent data: GIF in its place.
          htmlBody: '<p>Hi</p><img src="cid:missing@sender">',
          quoteHeaderHtml: 'On X, Sender wrote:',
          attachments: [],
        }}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByTestId('composer-send')[0]);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));

    const sent = onSend.mock.calls[0][0] as { attachments?: unknown[] };
    expect(uploadBlob).not.toHaveBeenCalled();
    expect(sent.attachments).toBeUndefined();
  });
  it('uploads the data: images of a quoted message at most maxConcurrentUpload at a time', async () => {
    // 1×1 PNG with a different trailing byte each: four distinct images.
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const quoted = [0, 1, 2, 3].map((i) => {
      const bytes = [...Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)), i];
      return `<img src="data:image/png;base64,${btoa(String.fromCharCode(...bytes))}" alt="pic ${i}">`;
    }).join('');
    let active = 0;
    let peak = 0;
    const uploadBlob = vi.fn(async (file: File) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return { blobId: `blob-${uploadBlob.mock.calls.length}`, size: file.size, type: file.type };
    });
    useAuthStore.setState({
      client: {
        uploadBlob,
        fetchBlobArrayBuffer: vi.fn(),
        hasDelayedSend: () => false,
        supportsPrincipals: () => false,
        getMaxDelayedSend: () => 0,
        // The server takes two uploads at once; six request slots leave room for four.
        getCapabilities: () => ({ 'urn:ietf:params:jmap:core': { maxConcurrentUpload: 2 } }),
        getMaxConcurrentRequests: () => 6,
      } as never,
    });
    const onSend = vi.fn();

    render(
      <EmailComposer
        mode="reply"
        onSend={onSend}
        replyTo={{
          from: [{ email: 'sender@example.com', name: 'Sender' }],
          subject: 'Newsletter',
          htmlBody: `<p>Hi</p>${quoted}`,
          quoteHeaderHtml: 'On X, Sender wrote:',
          attachments: [],
        }}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByTestId('composer-send')[0]);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));

    const sent = onSend.mock.calls[0][0] as { htmlBody?: string; attachments?: Array<{ disposition?: string }> };
    expect(uploadBlob).toHaveBeenCalledTimes(4);
    expect(peak).toBe(2);
    expect(sent.attachments).toHaveLength(4);
    expect(sent.htmlBody).not.toContain('data:image/png');
  });
});
