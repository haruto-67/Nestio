const EVENT_NAME = 'nestio:toast';

/** タスク作成/削除など、確認ダイアログは不要だが結果を一言伝えたい操作向けの軽量トースト */
export function showToast(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT_NAME, { detail: message }));
}

export function subscribeToast(callback: (message: string) => void): () => void {
  const handler = (e: Event) => callback((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
