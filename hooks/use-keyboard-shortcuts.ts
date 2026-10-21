"use client";

import { useEffect, useCallback, useMemo, useRef } from "react";
import { Email } from "@/lib/jmap/types";
import { isEditableEventTarget } from "@/lib/keyboard";
import {
  comboFromEvent,
  customComboMap,
  type CustomizableShortcutAction,
  type ShortcutBindings,
} from "@/lib/shortcut-bindings";

export interface KeyboardShortcutHandlers {
  // Navigation
  onNextEmail?: () => void;
  onPreviousEmail?: () => void;
  onOpenEmail?: () => void;
  onCloseEmail?: () => void;

  // Email actions
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
  onToggleStar?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onMarkAsUnread?: () => void;
  onMarkAsRead?: () => void;
  onToggleSpam?: () => void;

  // Global actions
  onCompose?: () => void;
  onFocusSearch?: () => void;
  onShowHelp?: () => void;
  onRefresh?: () => void;

  // Selection
  onSelectAll?: () => void;
  onDeselectAll?: () => void;

  // Thread actions
  onToggleThreadExpansion?: () => void;
}

/**
 * The handler behind each action that can take a custom key, and what it
 * needs, as in the built-in switch below: the message on screen, or that
 * message or a selection.
 */
const CUSTOM_KEY_TARGETS: Record<
  CustomizableShortcutAction,
  { handler: keyof KeyboardShortcutHandlers; needs?: "email" | "target" }
> = {
  "reply": { handler: "onReply", needs: "email" },
  "reply-all": { handler: "onReplyAll", needs: "email" },
  "forward": { handler: "onForward", needs: "email" },
  "toggle-star": { handler: "onToggleStar", needs: "email" },
  "archive": { handler: "onArchive", needs: "target" },
  "delete": { handler: "onDelete", needs: "target" },
  "mark-as-unread": { handler: "onMarkAsUnread", needs: "target" },
  "mark-as-read": { handler: "onMarkAsRead", needs: "target" },
  "toggle-spam": { handler: "onToggleSpam", needs: "target" },
  "compose": { handler: "onCompose" },
  "focus-search": { handler: "onFocusSearch" },
  "refresh": { handler: "onRefresh" },
};

export interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  emails: Email[];
  selectedEmailId?: string;
  selectionCount?: number;
  /** The user's own keys (settings `shortcutBindings`); each replaces the action's built-in keys. */
  customBindings?: ShortcutBindings;
  handlers: KeyboardShortcutHandlers;
}

// Shortcuts must fire regardless of the active keyboard layout (e.g. Cyrillic,
// Greek). Derive the key from the PHYSICAL key (event.code) instead of the
// layout-dependent event.key: letters from KeyA..KeyZ, and the symbol shortcuts
// (/, ?, #, !) from their US-QWERTY positions so they stay reachable on non-Latin
// layouts. Arrows/Enter/Escape keep event.key, which is already layout-neutral.
function physicalShortcutKey(event: KeyboardEvent): string {
  const code = event.code;
  if (code && code.length === 4 && code.startsWith("Key")) {
    return code.charAt(3).toLowerCase();
  }
  switch (code) {
    case "Slash":
      return event.shiftKey ? "?" : "/";
    case "Digit1":
      if (event.shiftKey) return "!";
      break;
    case "Digit3":
      if (event.shiftKey) return "#";
      break;
  }
  return event.key.toLowerCase();
}

export function useKeyboardShortcuts({
  enabled = true,
  emails,
  selectedEmailId,
  selectionCount = 0,
  customBindings,
  handlers,
}: UseKeyboardShortcutsOptions) {
  const handlersRef = useRef(handlers);
  const customCombos = useMemo(() => customComboMap(customBindings ?? {}), [customBindings]);

  // Keep handlers ref updated
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs. Must be event-based
      // (composedPath), not document.activeElement: the QuotedHtml island's
      // shadow root retargets activeElement to its plain-div host (#654).
      if (isEditableEventTarget(event)) return;

      const h = handlersRef.current;
      const key = physicalShortcutKey(event);
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      const hasBatchTarget = !!selectedEmailId || selectionCount > 0;

      // The user's own keys come first. A custom key is always the app's, so
      // the browser never sees it, even when the action has nothing to act on.
      // (A plugin's key never gets here: its capture listener stops it.)
      const combo = customCombos.size > 0 ? comboFromEvent(event) : null;
      const customAction = combo ? customCombos.get(combo) : undefined;
      if (customAction) {
        event.preventDefault();
        const target = CUSTOM_KEY_TARGETS[customAction];
        const ready = target.needs === "email" ? !!selectedEmailId
          : target.needs === "target" ? hasBatchTarget
          : true;
        if (ready) (h[target.handler] as (() => void) | undefined)?.();
        return;
      }
      // An action that has a custom key no longer answers to its built-in ones.
      const builtIn = (action: CustomizableShortcutAction, fn: (() => void) | undefined) => {
        if (!customBindings?.[action]) fn?.();
      };

      // Shortcuts that work with modifiers
      if (event.ctrlKey || event.metaKey) {
        switch (key) {
          case "a":
            // Ctrl/Cmd + A: Select all
            event.preventDefault();
            h.onSelectAll?.();
            return;
        }
      }

      // Shortcuts that should NOT work with modifiers
      if (hasModifier) return;

      switch (key) {
        // Navigation
        case "j":
        case "arrowdown":
          event.preventDefault();
          h.onNextEmail?.();
          break;

        case "k":
        case "arrowup":
          event.preventDefault();
          h.onPreviousEmail?.();
          break;

        case "enter":
        case "o":
          if (selectedEmailId) {
            event.preventDefault();
            h.onOpenEmail?.();
          }
          break;

        case "escape":
          event.preventDefault();
          h.onCloseEmail?.();
          h.onDeselectAll?.();
          break;

        // Email actions (only when email is selected)
        case "r":
          if (selectedEmailId) {
            event.preventDefault();
            if (event.shiftKey) {
              builtIn("reply-all", h.onReplyAll);
            } else {
              builtIn("reply", h.onReply);
            }
          }
          break;

        case "a":
          if (selectedEmailId) {
            event.preventDefault();
            builtIn("reply-all", h.onReplyAll);
          }
          break;

        case "f":
          if (selectedEmailId) {
            event.preventDefault();
            builtIn("forward", h.onForward);
          }
          break;

        case "s":
          if (selectedEmailId) {
            event.preventDefault();
            builtIn("toggle-star", h.onToggleStar);
          }
          break;

        case "e":
          if (hasBatchTarget) {
            event.preventDefault();
            builtIn("archive", h.onArchive);
          }
          break;

        case "#":
        case "delete":
        case "backspace":
          if (hasBatchTarget) {
            event.preventDefault();
            builtIn("delete", h.onDelete);
          }
          break;

        case "u":
          if (hasBatchTarget) {
            event.preventDefault();
            builtIn("mark-as-unread", h.onMarkAsUnread);
          }
          break;

        case "i":
          if (hasBatchTarget && event.shiftKey) {
            event.preventDefault();
            builtIn("mark-as-read", h.onMarkAsRead);
          }
          break;

        case "!":
          if (hasBatchTarget) {
            event.preventDefault();
            builtIn("toggle-spam", h.onToggleSpam);
          }
          break;

        // Global actions
        case "c":
          event.preventDefault();
          builtIn("compose", h.onCompose);
          break;

        case "/":
          event.preventDefault();
          builtIn("focus-search", h.onFocusSearch);
          break;

        case "?":
          event.preventDefault();
          h.onShowHelp?.();
          break;

        case "g":
          if (event.shiftKey) {
            event.preventDefault();
            builtIn("refresh", h.onRefresh);
          }
          break;

        // Thread actions
        case "x":
          if (selectedEmailId) {
            event.preventDefault();
            h.onToggleThreadExpansion?.();
          }
          break;
      }
    },
    [selectedEmailId, selectionCount, customCombos, customBindings]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);

  // Helper to get next/previous email
  const getAdjacentEmailIndex = useCallback(
    (direction: "next" | "previous"): number => {
      if (emails.length === 0) return -1;

      if (!selectedEmailId) {
        // If no email selected, select first (for next) or last (for previous)
        return direction === "next" ? 0 : emails.length - 1;
      }

      const currentIndex = emails.findIndex((e) => e.id === selectedEmailId);
      if (currentIndex === -1) return direction === "next" ? 0 : emails.length - 1;

      if (direction === "next") {
        return currentIndex < emails.length - 1 ? currentIndex + 1 : currentIndex;
      } else {
        return currentIndex > 0 ? currentIndex - 1 : currentIndex;
      }
    },
    [emails, selectedEmailId]
  );

  return { getAdjacentEmailIndex };
}

/** One row of the help modal. */
export interface ShortcutEntry {
  readonly key: string;
  readonly description: string;
  /** The action behind the row when its key can be changed in the settings. */
  readonly action?: CustomizableShortcutAction;
}

// Shortcut definitions for the help modal
export const KEYBOARD_SHORTCUTS = {
  navigation: [
    { key: "j / ↓", description: "shortcuts.navigation.next_email" },
    { key: "k / ↑", description: "shortcuts.navigation.previous_email" },
    { key: "Enter / o", description: "shortcuts.navigation.open_email" },
    { key: "Esc", description: "shortcuts.navigation.close_email" },
  ],
  actions: [
    { key: "r", description: "shortcuts.actions.reply", action: "reply" },
    { key: "R / a", description: "shortcuts.actions.reply_all", action: "reply-all" },
    { key: "f", description: "shortcuts.actions.forward", action: "forward" },
    { key: "s", description: "shortcuts.actions.star", action: "toggle-star" },
    { key: "e", description: "shortcuts.actions.archive", action: "archive" },
    { key: "# / Del", description: "shortcuts.actions.delete", action: "delete" },
    { key: "u", description: "shortcuts.actions.mark_unread", action: "mark-as-unread" },
    { key: "Shift + I", description: "shortcuts.actions.mark_read", action: "mark-as-read" },
    { key: "!", description: "shortcuts.actions.toggle_spam", action: "toggle-spam" },
  ],
  global: [
    { key: "c", description: "shortcuts.global.compose", action: "compose" },
    { key: "/", description: "shortcuts.global.search", action: "focus-search" },
    { key: "Ctrl/⌘ + K", description: "shortcuts.global.global_search" },
    { key: "?", description: "shortcuts.global.help" },
    { key: "Shift + G", description: "shortcuts.global.refresh", action: "refresh" },
    { key: "Ctrl + A", description: "shortcuts.global.select_all" },
  ],
  threads: [
    { key: "x", description: "shortcuts.threads.expand_collapse" },
  ],
  composer: [
    { key: "Ctrl/Cmd + Enter", description: "shortcuts.composer.send" },
    { key: "Ctrl/Cmd + Shift + Enter", description: "shortcuts.composer.schedule_send" },
    { key: "t", description: "shortcuts.composer.template_picker" },
  ],
} as const;
