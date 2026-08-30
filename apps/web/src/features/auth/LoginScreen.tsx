import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { googleLoginUrl } from '../../api/auth.js';

/** /auth/google/callback が申請中/却下の場合に付けて返す?login= を見て専用の画面を出す（改修10回目） */
function useLoginStatus(): 'pending' | 'rejected' | null {
  const value = new URLSearchParams(window.location.search).get('login');
  if (value === 'pending' || value === 'rejected') return value;
  return null;
}

// apps/api/src/routes/auth.tsのNATIVE_APP_CALLBACK_URLと一致させる
const NATIVE_APP_CALLBACK_URL = 'com.niwatorimc.nestio://login-callback';

/**
 * ネイティブアプリ(Capacitor)では Google OAuth を WKWebView 内で直接開くと
 * パスキー(WebAuthn)のBluetooth近接認証が機能せず、Googleが400 malformedを返すこともある。
 * システムブラウザ(SFSafariViewController)経由にすることで両方を回避する（改修20回目）。
 * Web版(PWA)は従来通り <a href> の通常ナビゲーションのまま変更しない。
 *
 * SFSafariViewControllerとアプリ本体のWKWebViewはCookieストアが別なため、ブラウザ内で
 * ログインが成功してもアプリ側のセッションには反映されない（ブラウザの中に丸ごとログイン後の
 * Nestioが表示されてしまい、閉じるとアプリ本体は未ログインのまま、という不具合として発覚）。
 * サーバー(/auth/google/callback)はログイン成功後、通常のリダイレクトではなくカスタムURL
 * スキーム(NATIVE_APP_CALLBACK_URL)へ遷移させ、ここでappUrlOpenイベントを受けてブラウザを
 * 閉じ、WKWebViewを再読み込みすることでログイン状態を反映させる。
 */
function useNativeGoogleLogin(): ((e: React.MouseEvent) => void) | undefined {
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isNative) return;
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (!url.startsWith(NATIVE_APP_CALLBACK_URL)) return;
      void Browser.close();
      const loginStatus = new URLSearchParams(url.split('?')[1] ?? '').get('login');
      if (loginStatus) {
        window.location.assign(`${window.location.pathname}?login=${loginStatus}`);
      } else {
        window.location.reload();
      }
    });
    return () => {
      void listener.then((l) => l.remove());
    };
  }, [isNative]);

  if (!isNative) return undefined;
  return (e) => {
    e.preventDefault();
    void Browser.open({ url: `${window.location.origin}${googleLoginUrl()}?native=1` });
  };
}

export function LoginScreen() {
  const loginStatus = useLoginStatus();
  const handleNativeClick = useNativeGoogleLogin();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white text-neutral-900 dark:bg-neutral-900 dark:text-white">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold">Nestio</h1>
        <p className="text-sm text-muted">巣に、今日やることを集めよう</p>
      </div>

      {loginStatus === 'pending' && (
        <p className="max-w-xs text-center text-sm text-muted">
          アカウント申請を受け付けました。管理者が承認するまでお待ちください
        </p>
      )}
      {loginStatus === 'rejected' && (
        <p className="max-w-xs text-center text-sm text-red-500">このアカウントでの利用は許可されていません</p>
      )}

      <a
        href={googleLoginUrl()}
        onClick={handleNativeClick}
        className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Googleでログイン
      </a>

      {/* import.meta.env.DEV は本番ビルド(pnpm build)には含まれないため、Web版・productionには
          出ない。Capacitorのローカルdev server検証時、Google OAuth設定なしでログイン済み状態を
          作るための一時的なショートカット（改修20回目、検証後削除予定） */}
      {import.meta.env.DEV && (
        <a href="/api/v1/dev/login" className="text-xs text-neutral-400 underline">
          開発用ログイン（ローカル専用）
        </a>
      )}
    </div>
  );
}
