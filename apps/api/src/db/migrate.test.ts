import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

describe('runMigrations', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it('docs/schema.sql 由来のテーブルを作成する', () => {
    db = new Database(':memory:');
    const { applied } = runMigrations(db);

    expect(applied).toContain('0001_init.sql');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const expected of ['users', 'folders', 'lists', 'tasks', 'tags', 'notes', 'attachments', 'triggers']) {
      expect(tables).toContain(expected);
    }
  });

  it('2回実行しても冪等（同じマイグレーションは再適用しない）', () => {
    db = new Database(':memory:');
    runMigrations(db);
    const second = runMigrations(db);

    expect(second.applied).toEqual([]);
  });

  it('ナレッジ用テーブルとFTS5を作成する（0015_knowledge.sql）', () => {
    db = new Database(':memory:');
    const { applied } = runMigrations(db);

    expect(applied).toContain('0015_knowledge.sql');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    for (const expected of ['knowledge', 'knowledge_tags', 'knowledge_links', 'knowledge_fts']) {
      expect(tables).toContain(expected);
    }
  });

  it('knowledgeのINSERT/UPDATE/DELETEがknowledge_ftsへ反映される', () => {
    db = new Database(':memory:');
    runMigrations(db);

    const now = Date.now();
    db.prepare(
      `INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'sub1', 'u1@example.com', 'ユーザー1', now);

    db.prepare(
      `INSERT INTO knowledge (id, user_id, title, description, body, category, created_at, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('k1', 'u1', '記憶規約', '書き方の規約', 'カテゴリ定義と記法', 'topic', now, now, 1);

    // trigramトークナイザは3文字未満のクエリにヒットしないため、検索語は3文字以上にする
    const hit = db
      .prepare(`SELECT knowledge.id as id FROM knowledge_fts JOIN knowledge ON knowledge.rowid = knowledge_fts.rowid
                 WHERE knowledge_fts MATCH ?`)
      .all('"記憶規約"') as { id: string }[];
    expect(hit.map((r) => r.id)).toEqual(['k1']);

    db.prepare(`UPDATE knowledge SET title = ?, updated_at = ? WHERE id = ?`).run('改訂後タイトル', now + 1, 'k1');
    const afterUpdate = db
      .prepare(`SELECT knowledge.id as id FROM knowledge_fts JOIN knowledge ON knowledge.rowid = knowledge_fts.rowid
                 WHERE knowledge_fts MATCH ?`)
      .all('"改訂後タイトル"') as { id: string }[];
    expect(afterUpdate.map((r) => r.id)).toEqual(['k1']);
    const oldTitleHit = db
      .prepare(`SELECT knowledge.id as id FROM knowledge_fts JOIN knowledge ON knowledge.rowid = knowledge_fts.rowid
                 WHERE knowledge_fts MATCH ?`)
      .all('"記憶規約"') as { id: string }[];
    expect(oldTitleHit).toEqual([]);

    db.prepare(`DELETE FROM knowledge WHERE id = ?`).run('k1');
    const afterDelete = db.prepare(`SELECT rowid FROM knowledge_fts`).all();
    expect(afterDelete).toEqual([]);
  });

  it('knowledgeのtitleはユーザー内で一意だが、論理削除後は再利用できる', () => {
    db = new Database(':memory:');
    runMigrations(db);

    const now = Date.now();
    db.prepare(
      `INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'sub1', 'u1@example.com', 'ユーザー1', now);
    db.prepare(
      `INSERT INTO knowledge (id, user_id, title, category, created_at, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('k1', 'u1', '重複タイトル', 'topic', now, now, 1);

    expect(() =>
      db
        .prepare(
          `INSERT INTO knowledge (id, user_id, title, category, created_at, updated_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('k2', 'u1', '重複タイトル', 'topic', now, now, 2),
    ).toThrow();

    db.prepare(`UPDATE knowledge SET deleted_at = ? WHERE id = ?`).run(now, 'k1');
    expect(() =>
      db
        .prepare(
          `INSERT INTO knowledge (id, user_id, title, category, created_at, updated_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('k3', 'u1', '重複タイトル', 'topic', now, now, 3),
    ).not.toThrow();
  });

  it('categoryに"decision"を追加し、既存行・FTSインデックスを保持する（0016_knowledge_decision_category.sql）', () => {
    db = new Database(':memory:');
    runMigrations(db);

    const now = Date.now();
    db.prepare(
      `INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'sub1', 'u1@example.com', 'ユーザー1', now);

    // マイグレーション前から存在していたはずの行（他のcategoryテスト同様、直接INSERTして
    // 「既存データがテーブル作り直し後も残り、FTSも新しいrowidに正しく対応する」ことを確認する
    db.prepare(
      `INSERT INTO knowledge (id, user_id, title, description, body, category, created_at, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('k1', 'u1', '既存トピック', '説明', '本文キーワード', 'topic', now, now, 1);

    expect(() =>
      db
        .prepare(
          `INSERT INTO knowledge (id, user_id, title, description, body, category, created_at, updated_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('k2', 'u1', 'DB選定の判断', '判断の記録', 'A案とB案', 'decision', now, now, 2),
    ).not.toThrow();

    expect(() =>
      db
        .prepare(
          `INSERT INTO knowledge (id, user_id, title, category, created_at, updated_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('k3', 'u1', '不正カテゴリ', 'invalid_category', now, now, 3),
    ).toThrow();

    const hit = db
      .prepare(`SELECT knowledge.id as id FROM knowledge_fts JOIN knowledge ON knowledge.rowid = knowledge_fts.rowid
                 WHERE knowledge_fts MATCH ?`)
      .all('"本文キーワード"') as { id: string }[];
    expect(hit.map((r) => r.id)).toEqual(['k1']);
  });
});
