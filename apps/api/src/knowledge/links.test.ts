import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { parseLinkedTitles, syncKnowledgeLinks, resolveIncomingLinks } from './links.js';

function insertKnowledge(db: Database.Database, userId: string, title: string, body = ''): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO knowledge (id, user_id, title, description, body, category, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, '', ?, 'topic', ?, ?, NULL, 1)`,
  ).run(id, userId, title, body, Date.now(), Date.now());
  return id;
}

function backlinkTitles(db: Database.Database, userId: string, toId: string): string[] {
  return (
    db
      .prepare(
        `SELECT knowledge.title as title FROM knowledge_links
         JOIN knowledge ON knowledge.id = knowledge_links.from_id
         WHERE knowledge_links.user_id = ? AND knowledge_links.deleted_at IS NULL AND knowledge_links.to_id = ?
         ORDER BY knowledge.title`,
      )
      .all(userId, toId) as { title: string }[]
  ).map((r) => r.title);
}

describe('knowledge links', () => {
  let db: Database.Database;
  afterEach(() => db?.close());

  it('parseLinkedTitlesは[[タイトル]]を重複無しで抽出し、表示名は無視する', () => {
    const titles = parseLinkedTitles('<p>[[記憶規約]]と[[記憶規約]]、[[育てるノート|表示名]]を参照</p>');
    expect(titles).toEqual(['記憶規約', '育てるノート']);
  });

  it('syncKnowledgeLinksはリンク先が存在すればto_idを解決する', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const target = insertKnowledge(db, userId, 'リンク先ノート');
    const from = insertKnowledge(db, userId, 'リンク元ノート');

    syncKnowledgeLinks(db, userId, from, '<p>[[リンク先ノート]]を参照</p>');

    expect(backlinkTitles(db, userId, target)).toEqual(['リンク元ノート']);
  });

  it('syncKnowledgeLinksはリンク先が存在しなければto_titleだけの未解決リンクとして残す', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const from = insertKnowledge(db, userId, 'リンク元ノート');

    syncKnowledgeLinks(db, userId, from, '<p>[[まだ無いノート]]</p>');

    const row = db
      .prepare('SELECT to_title, to_id FROM knowledge_links WHERE user_id = ? AND from_id = ?')
      .get(userId, from) as { to_title: string; to_id: string | null };
    expect(row.to_title).toBe('まだ無いノート');
    expect(row.to_id).toBeNull();
  });

  it('resolveIncomingLinksは後から作られたノートへの未解決リンクを解決する', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const from = insertKnowledge(db, userId, 'リンク元ノート');
    syncKnowledgeLinks(db, userId, from, '<p>[[後から作るノート]]</p>');

    const target = insertKnowledge(db, userId, '後から作るノート');
    resolveIncomingLinks(db, userId, '後から作るノート', target);

    const row = db
      .prepare('SELECT to_id FROM knowledge_links WHERE user_id = ? AND from_id = ?')
      .get(userId, from) as { to_id: string | null };
    expect(row.to_id).toBe(target);
    expect(backlinkTitles(db, userId, target)).toEqual(['リンク元ノート']);
  });

  it('syncKnowledgeLinksは本文から消えたリンクを論理削除し、再度呼ぶと冪等に扱う', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const target = insertKnowledge(db, userId, 'リンク先ノート');
    const from = insertKnowledge(db, userId, 'リンク元ノート');

    syncKnowledgeLinks(db, userId, from, '<p>[[リンク先ノート]]</p>');
    expect(backlinkTitles(db, userId, target)).toEqual(['リンク元ノート']);

    syncKnowledgeLinks(db, userId, from, '<p>リンクを消した</p>');
    expect(backlinkTitles(db, userId, target)).toEqual([]);

    // 同じ内容で2回呼んでも重複行が増えない（冪等）
    syncKnowledgeLinks(db, userId, from, '<p>リンクを消した</p>');
    const count = (
      db.prepare('SELECT COUNT(*) as c FROM knowledge_links WHERE user_id = ? AND from_id = ?').get(userId, from) as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);

    // 再度リンクを貼り直すと復元される（新規行を増やさない）
    syncKnowledgeLinks(db, userId, from, '<p>[[リンク先ノート]]</p>');
    expect(backlinkTitles(db, userId, target)).toEqual(['リンク元ノート']);
    const countAfterRelink = (
      db.prepare('SELECT COUNT(*) as c FROM knowledge_links WHERE user_id = ? AND from_id = ?').get(userId, from) as {
        c: number;
      }
    ).c;
    expect(countAfterRelink).toBe(1);
  });
});
