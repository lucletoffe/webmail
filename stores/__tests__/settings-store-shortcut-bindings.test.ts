import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../settings-store';

// Custom shortcut keys follow the user to every device, and a synced blob
// cannot hand the listener a key that is unknown or means two things.
describe('settings-store shortcutBindings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ shortcutBindings: { archive: 'mod+e' } });
  });

  it('is synced', () => {
    const exported = JSON.parse(useSettingsStore.getState().exportSettings());
    expect(exported.shortcutBindings).toEqual({ archive: 'mod+e' });
  });

  it('imports valid keys', () => {
    useSettingsStore.getState().importSettings(JSON.stringify({ shortcutBindings: { compose: 'y' } }));
    expect(useSettingsStore.getState().shortcutBindings).toEqual({ compose: 'y' });
  });

  it('drops keys that cannot be bound or collide', () => {
    useSettingsStore.getState().importSettings(JSON.stringify({
      shortcutBindings: { archive: 'mod+c', compose: 'f', reply: 'mod+e', delete: 'r', launch: 'l' },
    }));
    // compose cannot take forward's f; delete may take the r that reply gave up.
    expect(useSettingsStore.getState().shortcutBindings).toEqual({ reply: 'mod+e', delete: 'r' });
  });

  it('turns a value that is not a record into no custom keys', () => {
    useSettingsStore.getState().importSettings(JSON.stringify({ shortcutBindings: 'mod+e' }));
    expect(useSettingsStore.getState().shortcutBindings).toEqual({});
  });
});
