import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyboardShortcutSettings } from '../keyboard-shortcut-settings';
import { useSettingsStore } from '@/stores/settings-store';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { registerShortcuts } from '@/lib/plugin-sandbox/shortcuts';
import type { SandboxInstance } from '@/lib/plugin-sandbox/host-bridge';

vi.mock('../settings-section', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings-section')>()),
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function row(action: string) {
  return within(screen.getByTestId(`shortcut-row-${action}`));
}

/** Opens the recorder of a row and returns its input. */
function startRecording(action: string) {
  fireEvent.click(row(action).getByRole('button', { name: 'settings.keyboard_shortcuts.change' }));
  return row(action).getByRole('textbox', { name: 'settings.keyboard_shortcuts.recording' });
}

let unregisterPlugin: (() => void) | null = null;

describe('KeyboardShortcutSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ shortcutBindings: {} } as never);
  });

  afterEach(() => {
    unregisterPlugin?.();
    unregisterPlugin = null;
  });

  it('records Ctrl + E for archive and shows it in place of e', () => {
    render(<KeyboardShortcutSettings />);
    expect(row('archive').getByText('e')).toBeTruthy();

    const input = startRecording('archive');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'e', code: 'KeyE', ctrlKey: true });

    expect(useSettingsStore.getState().shortcutBindings).toEqual({ archive: 'mod+e' });
    expect(row('archive').getByText('Ctrl + E')).toBeTruthy();
  });

  it('refuses a key another action answers to and keeps listening', () => {
    render(<KeyboardShortcutSettings />);
    const input = startRecording('archive');

    fireEvent.keyDown(input, { key: 'r', code: 'KeyR' });
    expect(screen.getByRole('alert').textContent).toBe('settings.keyboard_shortcuts.taken');
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});

    fireEvent.keyDown(input, { key: 'e', code: 'KeyE', ctrlKey: true });
    expect(useSettingsStore.getState().shortcutBindings).toEqual({ archive: 'mod+e' });
  });

  it('refuses Shift + 1, which is the built-in ! of spam', () => {
    render(<KeyboardShortcutSettings />);
    const input = startRecording('compose');

    fireEvent.keyDown(input, { key: '!', code: 'Digit1', shiftKey: true });

    expect(screen.getByRole('alert').textContent).toBe('settings.keyboard_shortcuts.taken');
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});
  });

  it('refuses a key the browser keeps', () => {
    render(<KeyboardShortcutSettings />);
    const input = startRecording('archive');

    fireEvent.keyDown(input, { key: 'c', code: 'KeyC', ctrlKey: true });

    expect(screen.getByRole('alert').textContent).toBe('settings.keyboard_shortcuts.invalid');
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});
  });

  it('refuses a key a plugin has taken, without running the plugin', () => {
    const invokeHook = vi.fn().mockResolvedValue(undefined);
    unregisterPlugin = registerShortcuts(
      { pluginId: 'p', invokeHook } as unknown as SandboxInstance,
      [{ id: 'go', keys: 'Ctrl+Alt+E', label: 'Plugin go' }],
    );
    render(<KeyboardShortcutSettings />);
    const input = startRecording('archive');

    fireEvent.keyDown(input, { key: 'e', code: 'KeyE', ctrlKey: true, altKey: true });

    expect(screen.getByRole('alert').textContent).toBe('settings.keyboard_shortcuts.taken');
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});
    expect(invokeHook).not.toHaveBeenCalled();
  });

  it('does not run the mail shortcut of the key being recorded', () => {
    const onCompose = vi.fn();
    renderHook(() => useKeyboardShortcuts({ emails: [], handlers: { onCompose } }));
    render(<KeyboardShortcutSettings />);
    const input = startRecording('archive');

    fireEvent.keyDown(input, { key: 'c', code: 'KeyC' });

    expect(onCompose).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    render(<KeyboardShortcutSettings />);
    const input = startRecording('archive');

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(row('archive').getByText('e')).toBeTruthy();
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});
  });

  it('resets one action, then all', () => {
    useSettingsStore.setState({ shortcutBindings: { archive: 'mod+e', compose: 'y' } } as never);
    render(<KeyboardShortcutSettings />);

    fireEvent.click(row('archive').getByRole('button', { name: 'settings.keyboard_shortcuts.reset' }));
    expect(useSettingsStore.getState().shortcutBindings).toEqual({ compose: 'y' });

    fireEvent.click(screen.getByRole('button', { name: 'settings.keyboard_shortcuts.reset_all' }));
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});
  });
});
