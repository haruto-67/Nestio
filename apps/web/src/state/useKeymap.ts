import { useEffect, useState } from 'react';
import { parseKeymapOverrides, resolveKeymap, type KeymapAction } from '../lib/keymap.js';

const STORAGE_KEY = 'nestio_keymap_overrides';
const EVENT_NAME = 'nestio:keymap-changed';

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

  // useKeymap()はApp.tsx（実際にショートカットを発火する側）とShortcutHelpModal
  // （割り当てを変更する側）等、複数の場所で個別に呼ばれる。useStateはコンポーネントごとに
  // 独立しているため、変更イベントを飛ばして全インスタンスへ反映しないと、設定画面で
  // 変更しても実際のショートカット発火側が古い割り当てのまま反映されない不具合になる
  // （改修11回目フォローアップで発覚：再割り当て直後に新しいキーが効かなかった）
  useEffect(() => {
    const handler = () => setOverrides(loadOverrides());
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const setKey = (action: KeymapAction, key: string) => {
    const next = { ...overrides, [action]: key };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setOverrides(next);
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  };

  return { keymap, setKey };
}
