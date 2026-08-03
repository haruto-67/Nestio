import { useApp } from './AppProvider.js';
import { useUserSettings } from '../db/queries.js';
import { upsertUserSettings } from './actions.js';
import { parseKeymapOverrides, resolveKeymap, type KeymapAction } from '../lib/keymap.js';

export function useKeymap() {
  const { me } = useApp();
  const settings = useUserSettings();
  const overrides = settings ? parseKeymapOverrides(settings.keymap_json) : {};
  const keymap = resolveKeymap(overrides);

  const setKey = (action: KeymapAction, key: string) => {
    if (!me) return;
    const next = { ...overrides, [action]: key };
    upsertUserSettings(me.id, { keymap_json: JSON.stringify(next) });
  };

  return { keymap, setKey };
}
