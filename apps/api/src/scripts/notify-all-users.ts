/**
 * 運用系のバッチ処理（cronからのバックアップ失敗通知等）用CLIスクリプト。
 * `docker compose exec -T nestio node dist/scripts/notify-all-users.js "タイトル" "本文"` の形で呼ぶ想定
 * （改修5回目・改修4回目ブレインストーム案G「バックアップ失敗時の自己通知」）。
 * 1ユーザー・複数デバイス専用アプリのため全ユーザー（実質1人）へ送るだけでよい。
 */
import { loadEnv } from '../env.js';
import { createDbConnection } from '../db/client.js';
import { createLogger } from '../logger.js';
import { sendPushToUser } from '../push/sender.js';

async function main() {
  const [title, body] = process.argv.slice(2);
  if (!title || !body) {
    console.error('usage: notify-all-users.js <title> <body>');
    process.exit(1);
  }

  const env = loadEnv();
  const logger = createLogger(env);
  const db = createDbConnection(env.DB_PATH);

  const users = db.prepare('SELECT id FROM users').all() as { id: string }[];
  for (const u of users) {
    await sendPushToUser(db, env, logger, u.id, { title, body });
  }
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
