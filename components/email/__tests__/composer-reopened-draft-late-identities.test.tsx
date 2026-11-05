import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { EmailComposer } from '../email-composer';
import { useSettingsStore } from '@/stores/settings-store';
import { useIdentityStore } from '@/stores/identity-store';
import { SIGNATURE_BLOCK_MARKER, SIGNATURE_RANGE_MARKER, buildSignatureBlock } from '../signature-block';

// ─── Heavy component mocks (mirrors composer-draft-attachments.test.tsx) ─────

// A stand-in for the TipTap editor that reports itself ready, so the
// composer's signature swap runs on it (composer-org-signature.test.tsx).
const editorState = vi.hoisted(() => ({ html: '' }));
vi.mock('@/components/email/rich-text-editor', () => ({
  RichTextEditor: ({ content, onChange, onEditorReady }: {
    content: string;
    onChange: (html: string) => void;
    onEditorReady?: (editor: unknown) => void;
  }) => {
    editorState.html = content;
    const onChangeRef = React.useRef(onChange);
    onChangeRef.current = onChange;
    React.useEffect(() => {
      onEditorReady?.({
        isDestroyed: false,
        commands: {
          focus: () => {},
          setContent: (html: string) => {
            editorState.html = html;
            onChangeRef.current(html);
          },
        },
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement('div', { 'data-testid': 'rich-text-editor' });
  },
}));

vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/components/identity/sub-address-helper', () => ({ SubAddressHelper: () => null }));
vi.mock('@/components/templates/template-picker', () => ({ TemplatePicker: () => null }));
vi.mock('@/components/templates/template-form', () => ({ TemplateForm: () => null }));
vi.mock('@/components/files/file-preview-modal', () => ({ FilePreviewModal: () => null }));
vi.mock('@/hooks/use-focus-trap', () => ({
  useFocusTrap: () => ({ current: null }),
}));
vi.mock('@/hooks/use-pro-multi-account-identities', () => ({
  useProMultiAccountIdentities: () => ({ enabled: false, groups: [], allIdentities: [] }),
  stripCrossAccountIdentityPrefix: (id: string) => ({ localAccountId: null, rawId: id }),
}));

// ─── Store mocks ──────────────────────────────────────────────────────────────

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
    // Empty at first: the identities load after the composer opened.
    identities: [] as Array<Record<string, unknown>>,
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
  const state = {
    draftSaveEnabled: false,
    sendRawEmail: async () => ({ sent: true }),
  };
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
    // The default position: replies/forwards get the signature appended at
    // send time rather than embedded above the quote.
    signaturePosition: 'below_quote',
    signatureNewMailEnabled: true,
    signatureReplyForwardEnabled: true,
    signatureSeparatorEnabled: true,
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

// ─── Misc dependency mocks ────────────────────────────────────────────────────

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
  sanitizeSignatureHtmlForDisplay: (v: string) => v,
  sanitizeEmailHtml: (v: string) => v,
  sanitizePluginBodyHtml: (v: string) => v,
  escapeHtml: (v: string) => v,
  parseHtmlSafely: (html: string) => new DOMParser().parseFromString(html, 'text/html'),
}));

vi.mock('@/lib/email-threading', () => ({
  computeReplyThreadingHeaders: () => ({ inReplyTo: [], references: [] }),
}));
vi.mock('@/lib/sub-addressing', () => ({ generateSubAddress: () => '' }));
vi.mock('@/lib/debug', () => ({ debug: { log: () => {}, warn: () => {}, error: () => {} } }));
vi.mock('@/components/email/quoted-html', () => ({
  buildQuotedHtmlBlock: () => '',
  serializeEditorContent: () => editorState.html,
}));
vi.mock('@/lib/template-utils', () => ({ substitutePlaceholders: (s: string) => s }));

// ─── Tests ────────────────────────────────────────────────────────────────────

/**
 * undust fork, red team QGtKF2NJ §4: a re-opened draft whose identities
 * arrive after the composer opened (cold start, PWA, restored composer)
 * still got the signature, through the swap that follows an identity
 * change: "…Luc\n\n-- \nAlice". For a re-opened draft the swap only
 * replaces a signature Bulwark put in the body.
 */

const ME = { id: 'id-me', email: 'me@example.com', name: 'Me', htmlSignature: '<b>Alice</b>', textSignature: 'Alice', mayDelete: true };

const DRAFT = {
  to: 'bob@example.com',
  cc: '',
  bcc: '',
  subject: 'Chiffrage',
  body: '<p>Bonjour Bob,</p><p>Luc Létoffé<br>undust</p>',
  showCc: false,
  showBcc: false,
  selectedIdentityId: 'id-me',
  subAddressTag: '',
  mode: 'compose' as const,
  draftId: 'draft-from-agent',
};

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** Opens the draft with no identities yet, then lets them arrive. */
async function openThenLoadIdentities(initialData: typeof DRAFT, onSend = vi.fn()) {
  const view = render(<EmailComposer initialData={initialData} onSend={onSend} />);
  await act(async () => {
    useIdentityStore.setState({ identities: [ME] });
    view.rerender(<EmailComposer initialData={initialData} onSend={onSend} />);
  });
  return onSend;
}

async function send(onSend: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getAllByTestId('composer-send')[0]);
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  return onSend.mock.calls[0][0] as { body: string; htmlBody?: string };
}

describe('re-opened draft with identities that load late', () => {
  afterEach(() => {
    useSettingsStore.setState({ plainTextMode: false });
    useIdentityStore.setState({ identities: [] });
    vi.clearAllMocks();
  });

  it('adds no signature to an HTML draft written elsewhere', async () => {
    const onSend = await openThenLoadIdentities(DRAFT);

    expect(editorState.html).not.toContain('Alice');
    const sent = await send(onSend);
    expect(sent.htmlBody).not.toContain('Alice');
    expect(countOf(sent.htmlBody!, 'Luc Létoffé')).toBe(1);
  });

  it('adds no signature to a plain-text draft written elsewhere', async () => {
    useSettingsStore.setState({ plainTextMode: true });
    const onSend = await openThenLoadIdentities({ ...DRAFT, body: 'Bonjour Bob,\n\nLuc' });

    const sent = await send(onSend);
    expect(sent.body).toBe('Bonjour Bob,\n\nLuc');
  });

  it('still swaps a signature Bulwark put in an HTML draft for the identity that loaded', async () => {
    const body = `<p>Bonjour Bob,</p><p ${SIGNATURE_RANGE_MARKER}="separator">-- </p>${buildSignatureBlock('<b>Old</b>')}<p ${SIGNATURE_RANGE_MARKER}="end"></p>`;
    await openThenLoadIdentities({ ...DRAFT, body });

    expect(editorState.html).toContain('<b>Alice</b>');
    expect(editorState.html).not.toContain('<b>Old</b>');
    expect(countOf(editorState.html, SIGNATURE_BLOCK_MARKER)).toBe(1);
  });
});
