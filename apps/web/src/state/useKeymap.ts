import { useState } from 'react';
import { parseKeymapOverrides, resolveKeymap, type KeymapAction } from '../lib/keymap.js';

const STORAGE_KEY = 'nestio_keymap_overrides';

function loadOverrides(): Partial<Record<KeymapAction, string>> {
  return parseKeymapOverrides(localStorage.getItem(STORAGE_KEY) ?? '{}');
}

/**
 * キーボードショートカットの割り当てはデバイスごとの物理キーボードに依存するため、
 * デバイス間で揃える必要が無い（改修3回目：ユーザーの要望でuser_settings経由の
 * 同期をやめ、localStorage専用にした）
 */
export function useKeymap() {
  const [overrides, setOverrides] = useState(loadOverrides);
  const keymap = resolveKeymap(overrides);

  const setKey = (action: KeymapAction, key: string) => {
    const next = { ...overrides, [action]: key };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setOverrides(next);
  };

  return { keymap, setKey };
}
