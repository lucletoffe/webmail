import { describe, it, expect } from 'vitest';
import {
  comboFromEvent,
  formatCombo,
  isBindableCombo,
  sanitizeShortcutBindings,
  shortcutConflict,
} from '../shortcut-bindings';

function keydown(key: string, code: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, code, ...init });
}

describe('comboFromEvent', () => {
  it.each([
    ['Ctrl + E', keydown('e', 'KeyE', { ctrlKey: true }), 'mod+e'],
    ['Cmd + E', keydown('e', 'KeyE', { metaKey: true }), 'mod+e'],
    ['Ctrl + Shift + E', keydown('E', 'KeyE', { ctrlKey: true, shiftKey: true }), 'mod+shift+e'],
    ['Alt + E', keydown('e', 'KeyE', { altKey: true }), 'alt+e'],
    ['a bare letter', keydown('y', 'KeyY'), 'y'],
    // AZERTY's A sits where QWERTY has Q: the letter typed wins on a Latin layout.
    ['AZERTY A', keydown('a', 'KeyQ'), 'a'],
    // A Cyrillic layout falls back to the physical key.
    ['Cyrillic у on KeyE', keydown('у', 'KeyE', { ctrlKey: true }), 'mod+e'],
    ['Shift + 1', keydown('!', 'Digit1', { shiftKey: true }), 'shift+1'],
    ['a symbol keeps Shift in the character', keydown('?', 'Slash', { shiftKey: true }), '?'],
    ['Delete', keydown('Delete', 'Delete'), 'delete'],
    ['F2', keydown('F2', 'F2'), 'f2'],
  ])('%s', (_name, event, combo) => {
    expect(comboFromEvent(event)).toBe(combo);
  });

  it.each([
    ['Escape', keydown('Escape', 'Escape')],
    ['Enter', keydown('Enter', 'Enter')],
    ['Tab', keydown('Tab', 'Tab')],
    ['Space', keydown(' ', 'Space')],
    ['an arrow', keydown('ArrowDown', 'ArrowDown')],
    ['F5', keydown('F5', 'F5')],
    ['a lone modifier', keydown('Control', 'ControlLeft', { ctrlKey: true })],
    ['AltGr + E (€), which Windows reports as Ctrl + Alt', keydown('€', 'KeyE', { ctrlKey: true, altKey: true, modifierAltGraph: true })],
  ])('cannot bind %s', (_name, event) => {
    expect(comboFromEvent(event)).toBeNull();
  });
});

describe('isBindableCombo', () => {
  it.each(['mod+e', 'alt+e', 'y', 'mod+shift+e', 'shift+1', 'delete', 'mod+alt+c'])('allows %s', (combo) => {
    expect(isBindableCombo(combo)).toBe(true);
  });

  it.each([
    ['copy', 'mod+c'],
    ['paste', 'mod+v'],
    ['select all', 'mod+a'],
    ['close tab', 'mod+w'],
    ['the command palette', 'mod+k'],
    ['devtools', 'mod+shift+i'],
    ['next email', 'j'],
    ['the help', '?'],
    ['thread expansion', 'x'],
    ['garbage', 'mod+'],
    ['an uppercase key', 'E'],
  ])('refuses %s (%s)', (_name, combo) => {
    expect(isBindableCombo(combo)).toBe(false);
  });
});

describe('shortcutConflict', () => {
  it('frees Ctrl + E for archive', () => {
    expect(shortcutConflict('mod+e', 'archive', {})).toBeNull();
  });

  it('names the action whose built-in key it is', () => {
    expect(shortcutConflict('e', 'reply', {})).toBe('archive');
    expect(shortcutConflict('a', 'compose', {})).toBe('reply-all');
  });

  it('lets an action take a key another one gave up', () => {
    expect(shortcutConflict('e', 'reply', { archive: 'mod+e' })).toBeNull();
  });

  it('names the action holding it as a custom key', () => {
    expect(shortcutConflict('mod+e', 'delete', { archive: 'mod+e' })).toBe('archive');
  });

  it('lets an action keep its own built-in key', () => {
    expect(shortcutConflict('e', 'archive', {})).toBeNull();
  });

  it('sees Shift + 1 and Shift + 3 as the built-in ! and #', () => {
    expect(shortcutConflict('shift+1', 'compose', {})).toBe('toggle-spam');
    expect(shortcutConflict('shift+3', 'compose', {})).toBe('delete');
  });

  it('reports a key the app keeps', () => {
    expect(shortcutConflict('j', 'archive', {})).toBe('invalid');
  });
});

describe('sanitizeShortcutBindings', () => {
  it('keeps valid bindings, swaps included', () => {
    expect(sanitizeShortcutBindings({ archive: 'r', reply: 'mod+e' })).toEqual({ archive: 'r', reply: 'mod+e' });
  });

  it('drops unknown actions, non-strings and keys that cannot be bound', () => {
    expect(sanitizeShortcutBindings({ archive: 'mod+e', launch: 'l', reply: 3, delete: 'mod+c' })).toEqual({ archive: 'mod+e' });
  });

  it('drops a key that would mean two things', () => {
    expect(sanitizeShortcutBindings({ archive: 'r' })).toEqual({});
    expect(sanitizeShortcutBindings({ compose: 'shift+1' })).toEqual({});
    const both = sanitizeShortcutBindings({ archive: 'mod+e', delete: 'mod+e' });
    expect(Object.values(both)).toEqual(['mod+e']);
  });

  it('returns an empty map for anything but a record', () => {
    expect(sanitizeShortcutBindings(null)).toEqual({});
    expect(sanitizeShortcutBindings(['mod+e'])).toEqual({});
    expect(sanitizeShortcutBindings('mod+e')).toEqual({});
  });
});

describe('formatCombo', () => {
  it('spells the keys for the platform', () => {
    expect(formatCombo('mod+shift+e', false)).toBe('Ctrl + Shift + E');
    expect(formatCombo('mod+alt+e', true)).toBe('⌘ + ⌥ + E');
    expect(formatCombo('delete', false)).toBe('Del');
    expect(formatCombo('?', false)).toBe('?');
  });
});
