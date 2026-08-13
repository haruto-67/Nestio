import { getPushSubscriptionState } from './push-subscription.js';

const EVENT_NAME = 'nestio:push-prompt';

export interface PushPromptDetail {
  reason: string;
}

let promptedThisSession = false;

/**
 * 通知が必要になる操作（期限設定・ポモドーロ開始・Hatchのpush_notify保存）が起きた瞬間に
 * 許可を促すためのイベントを飛ばす。設定画面の奥に許可ボタンを置くだけだとユーザーが
 * 気づけないための対応。既に許可済み/拒否済み/非対応なら何も出さない。
 * 操作のたびに毎回出すとうるさいので、1ページセッションにつき1回だけ表示する。
 */
export async function requestPushPermissionPrompt(reason: string): Promise<void> {
  if (promptedThisSession) return;
  const { permission, subscribed } = await getPushSubscriptionState();
  if (permission === 'unsupported' || permission === 'denied' || subscribed) return;
  promptedThisSession = true;
  window.dispatchEvent(new CustomEvent<PushPromptDetail>(EVENT_NAME, { detail: { reason } }));
}

export function subscribePushPrompt(callback: (detail: PushPromptDetail) => void): () => void {
  const handler = (e: Event) => callback((e as CustomEvent<PushPromptDetail>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
