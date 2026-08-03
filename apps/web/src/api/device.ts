import { registerDevice } from './auth.js';

const DEVICE_ID_KEY = 'nestio_device_id';

/**
 * 端末識別子。認証情報ではないためlocalStorageに保存してよい
 * （セッションは別途 httpOnly Cookie で管理している）。
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const label = `${navigator.platform || 'unknown'} - ${new Date().toISOString().slice(0, 10)}`;
  const { device_id } = await registerDevice(label);
  localStorage.setItem(DEVICE_ID_KEY, device_id);
  return device_id;
}
