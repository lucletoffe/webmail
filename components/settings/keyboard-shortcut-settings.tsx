"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/settings-store';
import { usePolicyStore } from '@/stores/policy-store';
import { Button } from '@/components/ui/button';
import { KEYBOARD_SHORTCUTS, type ShortcutEntry } from '@/hooks/use-keyboard-shortcuts';
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
 * Settings > General > Keyboard shortcuts: one row per mail action, its key
 * (built-in or the user's own), and a recorder that takes the next key press.
 * A custom key replaces the built-in ones; see lib/shortcut-bindings.ts.
 */
export function KeyboardShortcutSettings() {
  const t = useTranslations();
  const bindings = useSettingsStore((s) => s.shortcutBindings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const features = usePolicyStore((s) => s.policy.features);
  const [recording, setRecording] = useState<CustomizableShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = ROWS.filter((entry) => !entry.feature || (features[entry.feature] ?? true));
  const labelOf = (action: CustomizableShortcutAction) => {
    const entry = ROWS.find((row) => row.action === action);
    return entry ? t(entry.description) : action;
  };

  useEffect(() => {
    if (!recording) return;
    // Capture phase, and stopped there, so the mail shortcuts never see the
    // keys being recorded.
    const onKeyDown = (event: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        setError(null);
        return;
      }
      const combo = comboFromEvent(event);
      const conflict = combo ? shortcutConflict(combo, recording, bindings) : 'invalid';
      if (conflict === 'invalid' || !combo) {
        setError(t('settings.keyboard_shortcuts.invalid', { key: combo ? formatCombo(combo) : event.key }));
        return;
      }
      if (conflict) {
        setError(t('settings.keyboard_shortcuts.taken', { key: formatCombo(combo), action: labelOf(conflict) }));
        return;
      }
      updateSetting('shortcutBindings', { ...bindings, [recording]: combo });
      setRecording(null);
      setError(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  // labelOf and t only read translations; the listener is rebuilt per recording.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, bindings, updateSetting]);

  const reset = (action: CustomizableShortcutAction) => {
    const { [action]: _, ...rest } = bindings;
    updateSetting('shortcutBindings', rest);
  };
  const hasCustom = Object.keys(bindings).length > 0;

  return (
    <SettingsSection
      id="keyboard-shortcuts"
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
                <span className="text-xs text-primary" role="status">
                  {t('settings.keyboard_shortcuts.recording')}
                </span>
              ) : (
                keys.map((key) => (
                  <kbd
                    key={key}
                    className={cn(
                      'inline-flex items-center justify-center px-2 py-0.5 min-w-[24px]',
                      'text-xs font-mono font-medium rounded border shadow-sm',
                      custom ? 'bg-primary/10 border-primary/40 text-foreground' : 'bg-muted border-border text-foreground',
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
              setRecording(null);
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
