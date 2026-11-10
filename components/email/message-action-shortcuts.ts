"use client";

import { useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import type { MessageActionKey } from "./message-actions";
import { formatShortcutCombo } from "@/lib/shortcut-keys";
import {
  formatCombo,
  isSingleKeyCombo,
  type CustomizableShortcutAction,
  type ShortcutBindings,
} from "@/lib/shortcut-bindings";

interface ShortcutHint {
  key: string;
  single: boolean;
  action: CustomizableShortcutAction;
}

/**
 * The keys the mail list runs a message's actions with (hooks/use-keyboard-shortcuts.ts),
 * as the message menus show them next to the entries. The native Message menu shows the
 * same built-in ones. A custom key (undust fork, keys1) replaces the built-in one, here as
 * in the list. A single key goes when the user turned single-key shortcuts off, since it
 * does nothing then.
 */
const KEYS: Partial<Record<MessageActionKey, ShortcutHint>> = {
  reply: { key: "R", single: true, action: "reply" },
  reply_all: { key: "Shift + R", single: true, action: "reply-all" },
  forward: { key: "F", single: true, action: "forward" },
  archive: { key: "E", single: true, action: "archive" },
  delete: { key: "Del", single: false, action: "delete" },
  star: { key: "S", single: true, action: "toggle-star" },
  spam: { key: "!", single: true, action: "toggle-spam" },
};

export function messageActionShortcut(
  key: MessageActionKey,
  options: { unread?: boolean; singleKeys: boolean; bindings?: ShortcutBindings },
): string | undefined {
  const builtIn: ShortcutHint | undefined = key === "read"
    ? options.unread
      ? { key: "Shift + I", single: true, action: "mark-as-read" }
      : { key: "U", single: true, action: "mark-as-unread" }
    : KEYS[key];
  if (!builtIn) return undefined;
  const custom = options.bindings?.[builtIn.action];
  // Spelled with "Ctrl" like the built-in keys; formatShortcutCombo adapts both to the platform.
  const entry = custom ? { key: formatCombo(custom, false), single: isSingleKeyCombo(custom) } : builtIn;
  if (entry.single && !options.singleKeys) return undefined;
  return entry.key;
}

/**
 * `messageActionShortcut` with the user's single-key setting and custom keys, in the app's
 * language as Windows writes the keys ("Umschalt + I" in German), for menus and tooltips.
 */
export function useMessageActionShortcut(): (key: MessageActionKey, unread?: boolean) => string | undefined {
  const singleKeys = useSettingsStore((state) => state.singleKeyShortcuts !== false);
  const bindings = useSettingsStore((state) => state.shortcutBindings);
  return useCallback((key, unread) => {
    const hint = messageActionShortcut(key, { unread, singleKeys, bindings });
    return hint && formatShortcutCombo(hint);
  }, [singleKeys, bindings]);
}
