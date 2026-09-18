import type Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { bumpSeq } from '../sync/seq.js';

/**
 * body（保存済みHTML。markdownToSafeHtmlは[[ ]]に手を入れないため元のまま残る）から
 * [[タイトル]] を抽出する。[[タイトル|表示名]] の表示名部分は無視してタイトルだけを解決キーにする
 * （改修24回目フォローアップ：Obsidianと同じくパスではなくタイトル完全一致で解決する）。
 */
export function parseLinkedTitles(body: string): string[] {
  const titles = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const title = (m[1] ?? '').split('|')[0]?.trim();
    if (title) titles.add(title);
  }
  return [...titles];
}

/**
 * ナレッジのbodyが保存されるたびに呼び出し、knowledge_linksをbody中の実際の[[リンク]]と
 * 一致させる。本文から消えたリンクは論理削除し、新しく現れたリンクは追加する
 * （リンク先が存在すればto_idを解決、無ければto_titleだけの未解決リンクとして残す）。
 */
export function syncKnowledgeLinks(db: Database.Database, userId: string, fromId: string, body: string): void {
  const titles = parseLinkedTitles(body);
  const titleSet = new Set(titles);
  const now = Date.now();

  const existingLinks = db
    .prepare('SELECT id, to_title, deleted_at FROM knowledge_links WHERE user_id = ? AND from_id = ?')
    .all(userId, fromId) as { id: string; to_title: string; deleted_at: number | null }[];
  const existingByTitle = new Map(existingLinks.map((l) => [l.to_title, l]));

  for (const link of existingLinks) {
    if (!titleSet.has(link.to_title) && link.deleted_at === null) {
      const seq = bumpSeq(db, userId);
      db.prepare('UPDATE knowledge_links SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ?').run(
        now,
        now,
        seq,
        link.id,
      );
    }
  }

  for (const title of titles) {
    const toRow = db
      .prepare('SELECT id FROM knowledge WHERE user_id = ? AND title = ? AND deleted_at IS NULL')
      .get(userId, title) as { id: string } | undefined;
    const toId = toRow?.id ?? null;

    const existing = existingByTitle.get(title);
    if (existing) {
      const seq = bumpSeq(db, userId);
      db.prepare('UPDATE knowledge_links SET to_id = ?, deleted_at = NULL, updated_at = ?, seq = ? WHERE id = ?').run(
        toId,
        now,
        seq,
        existing.id,
      );
      continue;
    }

    const seq = bumpSeq(db, userId);
    db.prepare(
      `INSERT INTO knowledge_links (id, user_id, from_id, to_title, to_id, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(uuidv7(), userId, fromId, title, toId, now, now, seq);
  }
}

/**
 * 新規ナレッジ作成時に、そのタイトルを指していた未解決リンク（to_id IS NULL）を解決する。
 * リンクした側が先に存在し、リンク先のノートが後から作られるケースに対応する。
 */
export function resolveIncomingLinks(db: Database.Database, userId: string, title: string, knowledgeId: string): void {
  const now = Date.now();
  const rows = db
    .prepare(
      'SELECT id FROM knowledge_links WHERE user_id = ? AND to_title = ? AND to_id IS NULL AND deleted_at IS NULL',
    )
    .all(userId, title) as { id: string }[];
  for (const row of rows) {
    const seq = bumpSeq(db, userId);
    db.prepare('UPDATE knowledge_links SET to_id = ?, updated_at = ?, seq = ? WHERE id = ?').run(
      knowledgeId,
      now,
      seq,
      row.id,
    );
  }
}
