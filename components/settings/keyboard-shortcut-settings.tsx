"use client";

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/settings-store';
import { Button } from '@/components/ui/button';
import { KEYBOARD_SHORTCUTS, type ShortcutEntry } from '@/hooks/use-keyboard-shortcuts';
import { pluginShortcutLabel } from '@/lib/plugin-sandbox/shortcuts';
import {
  comboFromEvent,
  formatCombo,
  shortcutConflict,
  type CustomizableShortcutAction,
} from '@/lib/shortcut-bindings';
import { cn } from '@/lib/utils';
import { SettingsSection, SettingItem } from './settings-section';

type CustomizableEntry = ShortcutEntry & { action: CustomizableShortcutAction };

/** The help modal's rows whose key the user may change, in its order. */
const ROWS: readonly CustomizableEntry[] = ([
  ...KEYBOARD_SHORTCUTS.actions,
  ...KEYBOARD_SHORTCUTS.global,
  ...KEYBOARD_SHORTCUTS.navigation,
] as readonly ShortcutEntry[]).filter((entry): entry is CustomizableEntry => !!entry.action);

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'Fn', 'OS']);

/**
 * Settings > Layout > Keyboard shortcuts: one row per mail action, its key
 * (built-in or the user's own), and a recorder that takes the next key press.
 * A custom key replaces the built-in ones; see lib/shortcut-bindings.ts.
 *
 * The recorder is a focused input: the mail and plugin shortcut listeners
 * skip key presses typed into a field, so recording a key never runs one.
 */
export function KeyboardShortcutSettings() {
  const t = useTranslations();
  const bindings = useSettingsStore((s) => s.shortcutBindings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const [recording, setRecording] = useState<CustomizableShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = ROWS;
  const labelOf = (action: CustomizableShortcutAction) => {
    const entry = ROWS.find((row) => row.action === action);
    return entry ? t(entry.description) : action;
  };
  const stopRecording = () => {
    setRecording(null);
    setError(null);
  };

  const record = (action: CustomizableShortcutAction, event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Tab still moves focus; a lone modifier waits for the key it goes with.
    if (event.key === 'Tab' || MODIFIER_KEYS.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      stopRecording();
      return;
    }
    const combo = comboFromEvent(event.nativeEvent);
    const plugin = pluginShortcutLabel(event.nativeEvent);
    const conflict = combo ? shortcutConflict(combo, action, bindings) : 'invalid';
    if (!combo || conflict === 'invalid') {
      setError(t('settings.keyboard_shortcuts.invalid', { key: combo ? formatCombo(combo) : event.key }));
      return;
    }
    if (conflict || plugin) {
      setError(t('settings.keyboard_shortcuts.taken', {
        key: formatCombo(combo),
        action: conflict ? labelOf(conflict) : plugin ?? '',
      }));
      return;
    }
    updateSetting('shortcutBindings', { ...bindings, [action]: combo });
    stopRecording();
  };

  const reset = (action: CustomizableShortcutAction) => {
    const { [action]: _, ...rest } = bindings;
    updateSetting('shortcutBindings', rest);
  };
  const hasCustom = Object.keys(bindings).length > 0;

  return (
    <SettingsSection
      title={t('settings.keyboard_shortcuts.title')}
      description={t('settings.keyboard_shortcuts.description')}
    >
      {rows.map((entry) => {
        const custom = bindings[entry.action];
        const isRecording = recording === entry.action;
        const keys = custom ? [formatCombo(custom)] : entry.key.split(' / ');
        return (
          <SettingItem key={entry.action} label={t(entry.description)}>
            <div className="flex flex-wrap items-center gap-1.5" data-testid={`shortcut-row-${entry.action}`}>
              {isRecording ? (
                <input
                  autoFocus
                  readOnly
                  aria-label={t('settings.keyboard_shortcuts.recording')}
                  placeholder={t('settings.keyboard_shortcuts.recording')}
                  onKeyDown={(event) => record(entry.action, event)}
                  className="h-7 w-64 max-w-full rounded border border-primary bg-background px-2 text-xs text-foreground placeholder:text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              ) : (
                keys.map((key) => (
                  <kbd
                    key={key}
                    className={cn(
                      'inline-flex items-center justify-center px-2 py-0.5 min-w-[24px]',
                      'text-xs font-mono font-medium rounded border shadow-sm text-foreground',
                      custom ? 'bg-primary/10 border-primary/40' : 'bg-muted border-border',
                    )}
                  >
                    {key}
                  </kbd>
                ))
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => {
                  setError(null);
                  setRecording(isRecording ? null : entry.action);
                }}
              >
                {isRecording ? t('common.cancel') : t('settings.keyboard_shortcuts.change')}
              </Button>
              {custom && !isRecording && (
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => reset(entry.action)}>
                  {t('settings.keyboard_shortcuts.reset')}
                </Button>
              )}
            </div>
            {isRecording && error && (
              <p className="text-xs text-destructive mt-1" role="alert">{error}</p>
            )}
          </SettingItem>
        );
      })}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-3">
        <p className="text-xs text-muted-foreground">{t('settings.keyboard_shortcuts.fixed_keys')}</p>
        {hasCustom && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 self-start"
            onClick={() => {
              stopRecording();
              updateSetting('shortcutBindings', {});
            }}
          >
            {t('settings.keyboard_shortcuts.reset_all')}
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
