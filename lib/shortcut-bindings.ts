// Custom keys for the mail actions (Settings > General > Keyboard shortcuts).
//
// A custom key REPLACES the action's built-in key(s), as Gmail's custom
// shortcuts do: rebinding archive to Ctrl+E frees `e`. Navigation (j/k,
// arrows, Enter/o, Esc, the `g` sequences, Shift + arrows), `x`, `?` and
// Ctrl/Cmd + A keep their keys, so the list and the help stay reachable.
//
// A combo is a string: optional "mod+" (Ctrl or Cmd, as everywhere else in the
// app), "alt+", "shift+", then the key: a lowercase letter or digit, one
// printable symbol, or a named key (delete, backspace, insert, f1..f10).

export const CUSTOMIZABLE_SHORTCUT_ACTIONS = [
  'reply',
  'reply-all',
  'forward',
  'toggle-star',
  'archive',
  'delete',
  'mark-as-unread',
  'mark-as-read',
  'toggle-spam',
  'compose',
  'focus-search',
  'refresh',
  'next-unread',
] as const;

export type CustomizableShortcutAction = typeof CUSTOMIZABLE_SHORTCUT_ACTIONS[number];

export type ShortcutBindings = Partial<Record<CustomizableShortcutAction, string>>;

/** The built-in keys of each customizable action, in combo form. */
export const DEFAULT_SHORTCUT_COMBOS: Record<CustomizableShortcutAction, readonly string[]> = {
  'reply': ['r'],
  'reply-all': ['shift+r', 'a'],
  'forward': ['f'],
  'toggle-star': ['s'],
  'archive': ['e'],
  'delete': ['#', 'delete', 'backspace'],
  'mark-as-unread': ['u'],
  'mark-as-read': ['shift+i'],
  'toggle-spam': ['!'],
  'compose': ['c'],
  'focus-search': ['/'],
  'refresh': ['shift+g'],
  'next-unread': ['n'],
};

/** Keys the app keeps for itself; a custom key may not take them. */
const FIXED_APP_COMBOS = new Set(['j', 'k', 'o', 'x', 'g', '?', 'shift+j', 'shift+k']);

// Ctrl/Cmd chords the browser or the app already use: copy/paste/undo, select
// all, find, print, reload, new/close tab or window, address bar, command palette.
const RESERVED_MOD_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y', 'w', 't', 'n', 'q', 'r', 'l', 'f', 'p', 'k']);
// Ctrl/Cmd + Shift chords browsers use (reopen tab, private window, devtools…).
const RESERVED_MOD_SHIFT_KEYS = new Set(['t', 'n', 'w', 'q', 'i', 'j', 'c', 'r', 'p', 'b', 'o', 'k', 'f', 'z']);

const NAMED_KEYS = new Set([
  'delete', 'backspace', 'insert',
  'f1', 'f2', 'f3', 'f4', 'f6', 'f7', 'f8', 'f9', 'f10',
]);

/**
 * The combo a keydown spells, or null for a key that cannot be bound (a lone
 * modifier, Escape, Enter, Tab, Space, arrows, F5, F11, F12…).
 *
 * Letters follow the layout when it is Latin (AZERTY's A records as `a`) and
 * the physical key otherwise, so a Cyrillic layout still records `e`. Digits
 * follow the physical key, symbols the character typed (Shift is part of it).
 */
export function comboFromEvent(event: KeyboardEvent): string | null {
  const code = event.code ?? '';
  const typed = (event.key ?? '').toLowerCase();
  let key: string;
  let shiftCounts = true;

  if (code.length === 4 && code.startsWith('Key')) {
    key = /^[a-z]$/.test(typed) ? typed : code.charAt(3).toLowerCase();
  } else if (code.length === 6 && code.startsWith('Digit')) {
    key = code.charAt(5);
  } else if (NAMED_KEYS.has(typed)) {
    key = typed;
  } else if (typed.length === 1 && typed.trim() !== '') {
    key = typed;
    shiftCounts = false;
  } else {
    return null;
  }

  const mod = event.ctrlKey || event.metaKey;
  return `${mod ? 'mod+' : ''}${event.altKey ? 'alt+' : ''}${shiftCounts && event.shiftKey ? 'shift+' : ''}${key}`;
}

interface ParsedCombo {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function parseCombo(combo: string): ParsedCombo | null {
  const match = /^(mod\+)?(alt\+)?(shift\+)?(.+)$/.exec(combo);
  if (!match) return null;
  const key = match[4];
  const valid = /^[a-z0-9]$/.test(key)
    || NAMED_KEYS.has(key)
    || (key.length === 1 && key.trim() !== '' && !/[A-Z]/.test(key));
  if (!valid) return null;
  return { mod: !!match[1], alt: !!match[2], shift: !!match[3], key };
}

/** Whether a combo may be used as a custom key at all (conflicts aside). */
export function isBindableCombo(combo: string): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;
  if (FIXED_APP_COMBOS.has(combo)) return false;
  if (parsed.mod && !parsed.alt) {
    if (!parsed.shift && RESERVED_MOD_KEYS.has(parsed.key)) return false;
    if (parsed.shift && RESERVED_MOD_SHIFT_KEYS.has(parsed.key)) return false;
  }
  return true;
}

/** The combos each action answers to: its custom key, else its built-in keys. */
export function effectiveCombos(
  action: CustomizableShortcutAction,
  bindings: ShortcutBindings,
): readonly string[] {
  const custom = bindings[action];
  return custom ? [custom] : DEFAULT_SHORTCUT_COMBOS[action];
}

/**
 * Why a combo cannot go to `action`: 'invalid' for a key that cannot be bound
 * or the app keeps, else the other action that already answers to it, or
 * null when it is free.
 */
export function shortcutConflict(
  combo: string,
  action: CustomizableShortcutAction,
  bindings: ShortcutBindings,
): 'invalid' | CustomizableShortcutAction | null {
  if (!isBindableCombo(combo)) return 'invalid';
  for (const other of CUSTOMIZABLE_SHORTCUT_ACTIONS) {
    if (other !== action && effectiveCombos(other, bindings).includes(combo)) return other;
  }
  return null;
}

/** combo -> action for every custom key. */
export function customComboMap(bindings: ShortcutBindings): Map<string, CustomizableShortcutAction> {
  const map = new Map<string, CustomizableShortcutAction>();
  for (const action of CUSTOMIZABLE_SHORTCUT_ACTIONS) {
    const combo = bindings[action];
    if (combo) map.set(combo, action);
  }
  return map;
}

/**
 * Keeps the bindings an imported or synced settings blob may carry: known
 * actions with a bindable combo, each combo used once, none taking another
 * action's built-in key.
 */
export function sanitizeShortcutBindings(value: unknown): ShortcutBindings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: ShortcutBindings = {};
  for (const action of CUSTOMIZABLE_SHORTCUT_ACTIONS) {
    const combo = source[action];
    if (typeof combo === 'string' && isBindableCombo(combo)) result[action] = combo;
  }
  // Drop bindings until no key means two things. Dropping one gives that
  // action its built-in keys back, which may collide in turn, hence the loop.
  let dropped = true;
  while (dropped) {
    dropped = false;
    for (const action of CUSTOMIZABLE_SHORTCUT_ACTIONS) {
      const combo = result[action];
      if (combo && shortcutConflict(combo, action, result) !== null) {
        delete result[action];
        dropped = true;
        break;
      }
    }
  }
  return result;
}

/** "mod+shift+e" -> "Ctrl + Shift + E" (or "⌘ + Shift + E" on Apple devices). */
export function formatCombo(combo: string, apple = isApplePlatform()): string {
  const parsed = parseCombo(combo);
  if (!parsed) return combo;
  const parts: string[] = [];
  if (parsed.mod) parts.push(apple ? '⌘' : 'Ctrl');
  if (parsed.alt) parts.push(apple ? '⌥' : 'Alt');
  if (parsed.shift) parts.push('Shift');
  const names: Record<string, string> = { delete: 'Del', backspace: 'Backspace', insert: 'Ins' };
  parts.push(names[parsed.key] ?? parsed.key.toUpperCase());
  return parts.join(' + ');
}

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
}
