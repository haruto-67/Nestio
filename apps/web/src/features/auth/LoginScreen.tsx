import { googleLoginUrl } from '../../api/auth.js';

export function LoginScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white text-neutral-900 dark:bg-neutral-900 dark:text-white">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold">Nestio</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">巣に、今日やることを集めよう</p>
      </div>
      <a
        href={googleLoginUrl()}
        className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Googleでログイン
      </a>
    </div>
  );
}
