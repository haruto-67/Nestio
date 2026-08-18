import { registerDevice } from './auth.js';

const DEVICE_ID_KEY = 'nestio_device_id';

/**
 * navigator.userAgentからOS/ブラウザを判定し「iPhone (Safari)」のような読める形にする
 * （改修14回目：以前はnavigator.platformの生値（"MacIntel"等）をそのまま使っており、
 * 設定画面の「ログイン中のセッション」一覧で「ブラウザ」としか分からず不便という指摘への対応）
 */
function detectDeviceLabel(): string {
  const ua = navigator.userAgent;

  let os = '不明な端末';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Macintosh/.test(ua)) os = 'Mac';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = '';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  return browser ? `${os} (${browser})` : os;
}

/**
 * 端末識別子。認証情報ではないためlocalStorageに保存してよい
 * （セッションは別途 httpOnly Cookie で管理している）。
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const label = detectDeviceLabel();
  const { device_id } = await registerDevice(label);
  localStorage.setItem(DEVICE_ID_KEY, device_id);
  return device_id;
}
