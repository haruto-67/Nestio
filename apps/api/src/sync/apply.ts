import type Database from 'better-sqlite3';
import { userSettingsWritableFields, type SyncOp, type SyncPushResponse, type SyncRejectReason } from '@nestio/shared';
import { SYNC_TABLES, isImplementedSyncTable, type ImplementedSyncTable } from './tables.js';
import { bumpSeq, getLastSeq } from './seq.js';
import { wouldCreateCycle, hasIncompleteDescendant, repairAncestorsCompletion } from './task-rules.js';

type ApplyResult = { ok: true } | { ok: false; reason: SyncRejectReason };
type Row = Record<string, unknown>;

/**
 * 複数ops を1トランザクションで順番に適用する（sync-protocol.md 4章）。
 *
 * 実装上の簡略化（docs/open-questions.md に記録済み）：
 * 仕様は同時刻の衝突を device_id の辞書順で解決するとしているが、
 * 行に「最終書き込みdevice_id」を保持するカラムが schema.sql に存在しないため、
 * 代わりに「op.updated_at >= 既存行.updated_at なら適用する」という決定的ルールを使う
 * （同時刻の場合は後から処理されたopが勝つ）。
 */
export function applySyncOps(
  db: Database.Database,
  userId: string,
  ops: SyncOp[],
): SyncPushResponse {
  const run = db.transaction(() => {
    const applied: string[] = [];
    const rejected: { op_id: string; reason: SyncRejectReason }[] = [];

    const alreadyAppliedStmt = db.prepare('SELECT 1 FROM applied_ops WHERE op_id = ?');
    const recordAppliedStmt = db.prepare(
      'INSERT INTO applied_ops (op_id, user_id, applied_at, result_seq) VALUES (?, ?, ?, ?)',
    );

    for (const op of ops) {
      if (alreadyAppliedStmt.get(op.op_id)) {
        applied.push(op.op_id);
        continue;
      }

      const result = applyOneOp(db, userId, op);
      if (result.ok) {
        applied.push(op.op_id);
        const resultSeq = getLastSeq(db, userId);
        recordAppliedStmt.run(op.op_id, userId, Date.now(), resultSeq);
      } else {
        rejected.push({ op_id: op.op_id, reason: result.reason });
      }
    }

    return { applied, rejected, next_seq: getLastSeq(db, userId) };
  });

  return run();
}

function applyOneOp(db: Database.Database, userId: string, op: SyncOp): ApplyResult {
  if (op.table === 'user_settings') {
    return applyUserSettingsOp(db, userId, op);
  }

  if (!isImplementedSyncTable(op.table)) {
    return { ok: false, reason: 'validation_failed' };
  }

  if (op.op === 'delete') {
    return applyDelete(db, op.table, userId, op);
  }

  const def = SYNC_TABLES[op.table];
  const parsed = def.writableSchema.safeParse(op.fields);
  if (!parsed.success) {
    return { ok: false, reason: 'validation_failed' };
  }
  const fields = parsed.data as Row;

  if (op.table === 'tasks') {
    return applyTaskUpsert(db, userId, op, fields);
  }

  return applyUpsert(db, op.table, userId, op, fields);
}

function fetchExisting(db: Database.Database, table: string, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
}

function applyUpsert(
  db: Database.Database,
  table: ImplementedSyncTable,
  userId: string,
  op: SyncOp,
  fields: Row,
  existingOverride?: Row | undefined,
): ApplyResult {
  const def = SYNC_TABLES[table];
  const existing = existingOverride !== undefined ? existingOverride : fetchExisting(db, table, op.id);

  if (existing && existing.user_id !== userId) {
    return { ok: false, reason: 'forbidden' };
  }

  if (!existing) {
    for (const requiredCol of def.requiredOnInsert) {
      if (fields[requiredCol] === undefined) {
        return { ok: false, reason: 'validation_failed' };
      }
    }

    const presentCols = def.columns.filter((c) => fields[c] !== undefined);
    const seq = bumpSeq(db, userId);
    const cols = ['id', 'user_id', ...presentCols, 'created_at', 'updated_at', 'deleted_at', 'seq'];
    const values: unknown[] = [
      op.id,
      userId,
      ...presentCols.map((c) => fields[c]),
      op.updated_at,
      op.updated_at,
      null,
      seq,
    ];
    const placeholders = cols.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
    return { ok: true };
  }

  const shouldApplyFields = op.updated_at >= (existing.updated_at as number);
  const seq = bumpSeq(db, userId);

  if (shouldApplyFields) {
    const presentCols = def.columns.filter((c) => fields[c] !== undefined);
    const setClauses = [...presentCols.map((c) => `${c} = ?`), 'updated_at = ?', 'seq = ?'];
    const values: unknown[] = [...presentCols.map((c) => fields[c]), op.updated_at, seq, op.id];
    db.prepare(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  } else {
    db.prepare(`UPDATE ${table} SET seq = ? WHERE id = ?`).run(seq, op.id);
  }

  return { ok: true };
}

function applyDelete(
  db: Database.Database,
  table: ImplementedSyncTable,
  userId: string,
  op: SyncOp,
): ApplyResult {
  const existing = fetchExisting(db, table, op.id);
  if (!existing) {
    // 存在しない行への削除は再送や順序ズレで起こり得るため無視（冪等）
    return { ok: true };
  }
  if (existing.user_id !== userId) {
    return { ok: false, reason: 'forbidden' };
  }

  const seq = bumpSeq(db, userId);
  if (op.updated_at >= (existing.updated_at as number)) {
    db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ?`).run(
      op.updated_at,
      op.updated_at,
      seq,
      op.id,
    );
  } else {
    db.prepare(`UPDATE ${table} SET seq = ? WHERE id = ?`).run(seq, op.id);
  }
  return { ok: true };
}

function applyTaskUpsert(db: Database.Database, userId: string, op: SyncOp, fields: Row): ApplyResult {
  const existing = fetchExisting(db, 'tasks', op.id);
  if (existing && existing.user_id !== userId) {
    return { ok: false, reason: 'forbidden' };
  }

  const finalDueAt = 'due_at' in fields ? fields.due_at : (existing?.due_at ?? null);
  const finalDueDate = 'due_date' in fields ? fields.due_date : (existing?.due_date ?? null);
  if (finalDueAt !== null && finalDueDate !== null) {
    return { ok: false, reason: 'validation_failed' };
  }

  if (fields.parent_id !== undefined && fields.parent_id !== null) {
    if (wouldCreateCycle(db, op.id, fields.parent_id as string)) {
      return { ok: false, reason: 'cycle_detected' };
    }
  }

  if (fields.completed_at !== undefined && fields.completed_at !== null) {
    if (hasIncompleteDescendant(db, op.id)) {
      return { ok: false, reason: 'parent_incomplete' };
    }
  }

  const result = applyUpsert(db, 'tasks', userId, op, fields, existing);
  if (!result.ok) return result;

  const finalCompletedAt = 'completed_at' in fields ? fields.completed_at : (existing?.completed_at ?? null);
  if (finalCompletedAt === null) {
    repairAncestorsCompletion(db, userId, op.id);
  }

  return { ok: true };
}

/**
 * user_settings は id を持たず PK が user_id 自体で、deleted_at も無い（1ユーザー1行、論理削除の概念がない）
 * ため、他テーブルと違う専用ロジックで扱う。op.id にはクライアントが自分の user_id を指定する。
 */
function applyUserSettingsOp(db: Database.Database, userId: string, op: SyncOp): ApplyResult {
  if (op.id !== userId) {
    return { ok: false, reason: 'forbidden' };
  }
  if (op.op === 'delete') {
    return { ok: false, reason: 'validation_failed' };
  }

  const parsed = userSettingsWritableFields.safeParse(op.fields);
  if (!parsed.success) {
    return { ok: false, reason: 'validation_failed' };
  }
  const fields = parsed.data as Row;

  const existing = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as Row | undefined;

  if (!existing) {
    const seq = bumpSeq(db, userId);
    db.prepare(
      'INSERT INTO user_settings (user_id, theme, keymap_json, updated_at, seq) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, (fields.theme as string | undefined) ?? 'light', (fields.keymap_json as string | undefined) ?? '{}', op.updated_at, seq);
    return { ok: true };
  }

  const shouldApplyFields = op.updated_at >= (existing.updated_at as number);
  const seq = bumpSeq(db, userId);

  if (shouldApplyFields) {
    const presentCols = ['theme', 'keymap_json'].filter((c) => fields[c] !== undefined);
    if (presentCols.length > 0) {
      const setClauses = [...presentCols.map((c) => `${c} = ?`), 'updated_at = ?', 'seq = ?'];
      const values: unknown[] = [...presentCols.map((c) => fields[c]), op.updated_at, seq];
      db.prepare(`UPDATE user_settings SET ${setClauses.join(', ')} WHERE user_id = ?`).run(...values, userId);
    } else {
      db.prepare('UPDATE user_settings SET updated_at = ?, seq = ? WHERE user_id = ?').run(op.updated_at, seq, userId);
    }
  } else {
    db.prepare('UPDATE user_settings SET seq = ? WHERE user_id = ?').run(seq, userId);
  }

  return { ok: true };
}
