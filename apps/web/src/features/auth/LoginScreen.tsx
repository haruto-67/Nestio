import { googleLoginUrl } from '../../api/auth.js';

/** /auth/google/callback が申請中/却下の場合に付けて返す?login= を見て専用の画面を出す（改修10回目） */
function useLoginStatus(): 'pending' | 'rejected' | null {
  const value = new URLSearchParams(window.location.search).get('login');
  if (value === 'pending' || value === 'rejected') return value;
  return null;
}

export function LoginScreen() {
  const loginStatus = useLoginStatus();

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
        className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Googleでログイン
      </a>
    </div>
  );
}
