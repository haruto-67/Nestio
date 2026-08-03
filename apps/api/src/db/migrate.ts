import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbConnection } from './client.js';
import { loadEnv } from '../env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * `migrations/*.sql` をファイル名の昇順で適用する。
 * `docs/schema.sql`（確定版DDL）は 0001_init.sql としてそのまま取り込み済み。
 * 以後のスキーマ変更は番号を進めた新しいファイルを追加する形で行う。
 */
export function runMigrations(db: Database.Database): { applied: string[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT    NOT NULL PRIMARY KEY,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const already = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => (row as { name: string }).name),
  );

  const applied: string[] = [];
  const markApplied = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');

  for (const file of files) {
    if (already.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const applyOne = db.transaction(() => {
      db.exec(sql);
      markApplied.run(file, Date.now());
    });
    applyOne();
    applied.push(file);
  }

  return { applied };
}

async function main() {
  const env = loadEnv();
  const db = createDbConnection(env.DB_PATH);
  const { applied } = runMigrations(db);
  if (applied.length === 0) {
    console.log('適用すべきマイグレーションはありません');
  } else {
    console.log('マイグレーションを適用しました:', applied.join(', '));
  }
  db.close();
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
