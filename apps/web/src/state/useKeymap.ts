import { useApp } from './AppProvider.js';
import { upsertUserSettingsOp } from './actions.js';
import { parseKeymapOverrides, resolveKeymap, type KeymapAction } from '../lib/keymap.js';

export function useKeymap() {
  const { data, me, submitOps } = useApp();
  const overrides = data.userSettings ? parseKeymapOverrides(data.userSettings.keymap_json) : {};
  const keymap = resolveKeymap(overrides);

  const setKey = (action: KeymapAction, key: string) => {
    if (!me) return;
    const next = { ...overrides, [action]: key };
    submitOps([upsertUserSettingsOp(me.id, { keymap_json: JSON.stringify(next) })]).catch((err) =>
      console.error(err),
    );
  };

  return { keymap, setKey };
}
