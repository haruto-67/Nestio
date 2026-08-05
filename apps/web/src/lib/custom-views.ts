import { uuidv7 } from '@nestio/shared';

export interface CustomSmartView {
  id: string;
  name: string;
  tagIds: string[];
}

const STORAGE_KEY = 'nestio_custom_smart_views';
const EVENT_NAME = 'nestio:custom-views-changed';

/**
 * タグの組み合わせで保存するカスタムスマートビュー（改修5回目）。
 * user_settingsに新しいカラムを足すとdocs/schema.sqlの変更が要るため、
 * 改修3回目でテーマ/キーマップをlocalStorage化したのと同じ方針でデバイスローカルに保存する
 * （複数デバイス間では同期されない）
 */
export function loadCustomViews(): CustomSmartView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomSmartView[]) : [];
  } catch {
    return [];
  }
}

function save(views: CustomSmartView[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function createCustomView(name: string, tagIds: string[]): CustomSmartView {
  const view: CustomSmartView = { id: uuidv7(), name, tagIds };
  save([...loadCustomViews(), view]);
  return view;
}

export function deleteCustomView(id: string): void {
  save(loadCustomViews().filter((v) => v.id !== id));
}

export function subscribeCustomViews(onChange: () => void): () => void {
  window.addEventListener(EVENT_NAME, onChange);
  return () => window.removeEventListener(EVENT_NAME, onChange);
}
