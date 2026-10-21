import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyboardShortcutSettings } from '../keyboard-shortcut-settings';
import { useSettingsStore } from '@/stores/settings-store';

vi.mock('../settings-section', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings-section')>()),
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function press(key: string, code: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...init }));
  });
}

function row(action: string) {
  return within(screen.getByTestId(`shortcut-row-${action}`));
}

describe('KeyboardShortcutSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ shortcutBindings: {} } as never);
  });

  it('records Ctrl + E for archive and shows it in place of e', () => {
    render(<KeyboardShortcutSettings />);
    expect(row('archive').getByText('e')).toBeTruthy();

    fireEvent.click(row('archive').getByRole('button', { name: 'settings.keyboard_shortcuts.change' }));
    press('Control', 'ControlLeft', { ctrlKey: true });
    press('e', 'KeyE', { ctrlKey: true });

    expect(useSettingsStore.getState().shortcutBindings).toEqual({ archive: 'mod+e' });
    expect(row('archive').getByText('Ctrl + E')).toBeTruthy();
  });

  it('refuses a key another action answers to and keeps listening', () => {
    render(<KeyboardShortcutSettings />);
    fireEvent.click(row('archive').getByRole('button', { name: 'settings.keyboard_shortcuts.change' }));

    press('r', 'KeyR');
    expect(screen.getByRole('alert').textContent).toBe('settings.keyboard_shortcuts.taken');
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});

    press('e', 'KeyE', { ctrlKey: true });
    expect(useSettingsStore.getState().shortcutBindings).toEqual({ archive: 'mod+e' });
  });

  it('refuses a key the browser keeps', () => {
    render(<KeyboardShortcutSettings />);
    fireEvent.click(row('archive').getByRole('button', { name: 'settings.keyboard_shortcuts.change' }));

    press('c', 'KeyC', { ctrlKey: true });

    expect(screen.getByRole('alert').textContent).toBe('settings.keyboard_shortcuts.invalid');
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});
  });

  it('cancels on Escape', () => {
    render(<KeyboardShortcutSettings />);
    fireEvent.click(row('archive').getByRole('button', { name: 'settings.keyboard_shortcuts.change' }));

    press('Escape', 'Escape');

    expect(row('archive').getByText('e')).toBeTruthy();
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});
  });

  it('keeps the recorded keys from the mail shortcuts', () => {
    const mailListener = vi.fn();
    window.addEventListener('keydown', mailListener);
    render(<KeyboardShortcutSettings />);
    fireEvent.click(row('archive').getByRole('button', { name: 'settings.keyboard_shortcuts.change' }));

    press('e', 'KeyE', { ctrlKey: true });

    expect(mailListener).not.toHaveBeenCalled();
    window.removeEventListener('keydown', mailListener);
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
