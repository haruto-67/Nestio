import type { ReactNode } from 'react';

const EVENT_NAME = 'nestio:toast';

export interface ToastOptions {
  /** 「元に戻す」ボタンを表示し、クリックされたらこれを呼ぶ（改修13回目：削除等の
   * 誤操作時に直前の操作内容が分かる形で取り消せるようにする要望への対応） */
  onUndo?: () => void;
  /** メッセージの前に軽くポップして表示するアイコン（改修13回目：Hatch発火通知に
   * 世界観のモチーフを添えて存在感を出す要望への対応） */
  icon?: ReactNode;
}

interface ToastDetail {
  message: string;
  options: ToastOptions;
}

/** タスク作成/削除など、確認ダイアログは不要だが結果を一言伝えたい操作向けの軽量トースト */
export function showToast(message: string, options: ToastOptions = {}): void {
  window.dispatchEvent(new CustomEvent<ToastDetail>(EVENT_NAME, { detail: { message, options } }));
}

export function subscribeToast(callback: (message: string, options: ToastOptions) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ToastDetail>).detail;
    callback(detail.message, detail.options);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
