import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { registerShortcuts } from '@/lib/plugin-sandbox/shortcuts';
import type { SandboxInstance } from '@/lib/plugin-sandbox/host-bridge';
import { useKeyboardShortcuts } from '../use-keyboard-shortcuts';

// Settings > General > Keyboard shortcuts: a custom key replaces the action's
// built-in ones.

function press(key: string, code: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts: custom keys', () => {
  it('archives on Ctrl + E once archive is bound to it', () => {
    const onArchive = vi.fn();
    renderHook(() => useKeyboardShortcuts({
      emails: [], selectedEmailId: 'e1', customBindings: { archive: 'mod+e' }, handlers: { onArchive },
    }));

    const event = press('e', 'KeyE', { ctrlKey: true });

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('acts on a selection too, as the built-in key does', () => {
    const onArchive = vi.fn();
    renderHook(() => useKeyboardShortcuts({
      emails: [], selectionCount: 3, customBindings: { archive: 'mod+e' }, handlers: { onArchive },
    }));

    press('e', 'KeyE', { metaKey: true });

    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it('frees the built-in key', () => {
    const onArchive = vi.fn();
    renderHook(() => useKeyboardShortcuts({
      emails: [], selectedEmailId: 'e1', customBindings: { archive: 'mod+e' }, handlers: { onArchive },
    }));

    press('e', 'KeyE');

    expect(onArchive).not.toHaveBeenCalled();
  });

  it('keeps the key from the browser even with nothing to archive', () => {
    const onArchive = vi.fn();
    renderHook(() => useKeyboardShortcuts({
      emails: [], customBindings: { archive: 'mod+e' }, handlers: { onArchive },
    }));

    const event = press('e', 'KeyE', { ctrlKey: true });

    expect(onArchive).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Ctrl + E alone without a custom key', () => {
    const onArchive = vi.fn();
    renderHook(() => useKeyboardShortcuts({ emails: [], selectedEmailId: 'e1', handlers: { onArchive } }));

    const event = press('e', 'KeyE', { ctrlKey: true });

    expect(onArchive).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves the other actions on their built-in keys', () => {
    const onReply = vi.fn();
    renderHook(() => useKeyboardShortcuts({
      emails: [], selectedEmailId: 'e1', customBindings: { archive: 'mod+e' }, handlers: { onReply },
    }));

    press('r', 'KeyR');

    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('runs a global action on a bare custom key', () => {
    const onCompose = vi.fn();
    renderHook(() => useKeyboardShortcuts({ emails: [], customBindings: { compose: 'y' }, handlers: { onCompose } }));

    press('y', 'KeyY');
    press('c', 'KeyC');

    expect(onCompose).toHaveBeenCalledTimes(1);
  });

  it('leaves a key a plugin has taken to the plugin', () => {
    const onArchive = vi.fn();
    const invokeHook = vi.fn().mockResolvedValue(undefined);
    const unregister = registerShortcuts(
      { pluginId: 'p', invokeHook } as unknown as SandboxInstance,
      [{ id: 'go', keys: 'Ctrl+Alt+E', label: 'Plugin go' }],
    );
    renderHook(() => useKeyboardShortcuts({
      emails: [], selectedEmailId: 'e1', customBindings: { archive: 'mod+alt+e' }, handlers: { onArchive },
    }));

    press('e', 'KeyE', { ctrlKey: true, altKey: true });
    unregister();

    expect(invokeHook).toHaveBeenCalledWith('shortcut:go', []);
    expect(onArchive).not.toHaveBeenCalled();
  });
});
