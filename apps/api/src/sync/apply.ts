import type Database from 'better-sqlite3';
import {
  uuidv7,
  userSettingsWritableFields,
  type SyncOp,
  type SyncPushResponse,
  type SyncRejectReason,
} from '@nestio/shared';
import { SYNC_TABLES, isImplementedSyncTable, type ImplementedSyncTable } from './tables.js';
import { bumpSeq, getLastSeq } from './seq.js';
import { wouldCreateCycle, hasIncompleteDescendant, repairAncestorsCompletion } from './task-rules.js';
import { rescheduleDueReminder } from '../push/scheduler.js';
import { detectTaskEvent, detectListAllCompleted } from '../hatch/event-detector.js';
import { resolveEditableListOwner, findListOwnerId } from '../shares/list-shares.js';
import { replicateToSharedEditors } from '../shares/replication.js';

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
  options: { triggeredByHatch?: boolean } = {},
): SyncPushResponse {
  const triggeredByHatch = options.triggeredByHatch ?? false;

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

      const result = applyOneOp(db, userId, op, triggeredByHatch);
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

function applyOneOp(db: Database.Database, userId: string, op: SyncOp, triggeredByHatch: boolean): ApplyResult {
  if (op.table === 'user_settings') {
    return applyUserSettingsOp(db, userId, op);
  }

  if (!isImplementedSyncTable(op.table)) {
    return { ok: false, reason: 'validation_failed' };
  }

  if (op.op === 'delete') {
    const result = applyDelete(db, op.table, userId, op);
    if (result.ok && op.table === 'tasks') {
      // 完了扱いのキャンセル呼び出し：新規予約はせず既存の未送信リマインダーだけ取り消す。
      // 共有リストのタスクをeditorが削除した場合もowner宛の予約を取り消す必要があるため、
      // 呼び出し元のuserId（callerId）ではなく実際のタスクのowner_idを使う（改修22回目）
      const ownerId = (fetchExisting(db, 'tasks', op.id)?.user_id as string | undefined) ?? userId;
      rescheduleDueReminder(db, ownerId, op.id, '', null, null, Date.now());
    }
    return result;
  }

  if (op.op === 'restore') {
    const result = applyRestore(db, op.table, userId, op);
    if (result.ok && op.table === 'tasks') {
      const restored = fetchExisting(db, 'tasks', op.id);
      if (restored) {
        rescheduleDueReminder(
          db,
          restored.user_id as string,
          op.id,
          restored.title as string,
          restored.due_at as number | null,
          restored.due_date as string | null,
          restored.completed_at as number | null,
        );
      }
    }
    return result;
  }

  const def = SYNC_TABLES[op.table];
  const parsed = def.writableSchema.safeParse(op.fields);
  if (!parsed.success) {
    return { ok: false, reason: 'validation_failed' };
  }
  const fields = resolveFieldMergeConflict(db, op, parsed.data as Row);

  if (op.table === 'tasks') {
    return applyTaskUpsert(db, userId, op, fields, triggeredByHatch);
  }

  return applyUpsert(db, op.table, userId, op, fields);
}

/**
 * table行の書き込み可否を判定し、可能ならそのuser_id（＝seq採番先。共有リストのタスクなら
 * ownerのuser_id）を返す。不可ならnull（改修22回目：リスト共有対応）。
 * tasks以外のテーブルは共有非対応のため、callerId自身の行かどうかだけを見る
 */
function resolveOwnerForExisting(
  db: Database.Database,
  table: ImplementedSyncTable,
  callerId: string,
  existing: Row,
): string | null {
  const ownerId = existing.user_id as string;
  if (ownerId === callerId) return ownerId;
  if (table !== 'tasks') return null;
  const resolved = resolveEditableListOwner(db, callerId, existing.list_id as string);
  return resolved === ownerId ? ownerId : null;
}

function fetchExisting(db: Database.Database, table: string, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
}

/** テーブルごとの「本文」フィールド。フィールド単位マージの対象はここだけ（改修5回目） */
const MERGEABLE_FIELD: Partial<Record<string, string>> = { tasks: 'note', notes: 'body' };

/**
 * op.base_fields（クライアントが編集を開始した時点で見ていた値）と現在サーバーに保存されている値を
 * 比較し、クライアントが知らない間に他デバイスが同じフィールドを書き換えていた場合（真の同時編集）は
 * 素のLWW上書きをせず、両方の内容をgit風のコンフリクトマーカーで残す。
 * base_fieldsが無い（旧クライアント・対象外テーブル）場合や衝突が無い場合はfieldsをそのまま返す。
 */
function resolveFieldMergeConflict(db: Database.Database, op: SyncOp, fields: Row): Row {
  const fieldName = MERGEABLE_FIELD[op.table];
  if (!fieldName) return fields;
  const incomingValue = fields[fieldName];
  if (typeof incomingValue !== 'string') return fields;
  const baseValue = op.base_fields?.[fieldName];
  if (typeof baseValue !== 'string') return fields;

  const existing = fetchExisting(db, op.table, op.id);
  const currentValue = existing?.[fieldName];
  if (typeof currentValue !== 'string') return fields;

  if (currentValue === baseValue) return fields; // サーバー側はbaseから変わっていない→衝突なし
  if (currentValue === incomingValue) return fields; // 既に同じ内容

  const merged =
    `<div>&lt;&lt;&lt;&lt;&lt;&lt;&lt; 相手の変更（他デバイスで保存済み）</div>` +
    currentValue +
    `<div>=======</div>` +
    incomingValue +
    `<div>&gt;&gt;&gt;&gt;&gt;&gt;&gt; あなたの変更</div>` +
    `<div>&lt;&lt;&lt;&lt;&lt;&lt;&lt; 同時編集が検出されました。不要な方を削除してください &gt;&gt;&gt;&gt;&gt;&gt;&gt;</div>`;

  return { ...fields, [fieldName]: merged };
}

/**
 * ownerId：新規行のuser_id・既存行の所有権対象・seq採番先。tasks以外はcallerId自身と常に一致する。
 * tasksの場合、共有リストへの書き込みではapplyTaskUpsertが解決した「そのタスクのowner」が渡される
 */
function applyUpsert(
  db: Database.Database,
  table: ImplementedSyncTable,
  ownerId: string,
  op: SyncOp,
  fields: Row,
  existingOverride?: Row | undefined,
): ApplyResult {
  const def = SYNC_TABLES[table];
  const existing = existingOverride !== undefined ? existingOverride : fetchExisting(db, table, op.id);

  if (existing && existing.user_id !== ownerId) {
    return { ok: false, reason: 'forbidden' };
  }

  if (!existing) {
    for (const requiredCol of def.requiredOnInsert) {
      if (fields[requiredCol] === undefined) {
        return { ok: false, reason: 'validation_failed' };
      }
    }

    // task_tags(task_id, tag_id)には論理削除を無視したUNIQUE制約(docs/schema.sql)があり、
    // 同じペアへ別idで新規INSERTしようとすると生のSQLite例外でリクエスト全体が落ちてしまう。
    // クライアント側（apps/web/src/state/actions.ts）・MCP側（apps/api/src/mcp/tools.ts）は
    // 修正済みだが、既にoutboxに積まれた古いクライアントのop（＝この状況）や他経路からの
    // 重複要求に対してもサーバー側で必ず安全に倒せるようにする（改修21回目、本番ログで
    // 実際にUNIQUE constraint failedが繰り返し発生しoutboxが詰まっていたことが発覚）
    if (table === 'task_tags') {
      const conflict = db
        .prepare('SELECT * FROM task_tags WHERE user_id = ? AND task_id = ? AND tag_id = ?')
        .get(ownerId, fields.task_id, fields.tag_id) as Row | undefined;
      if (conflict) {
        if (conflict.deleted_at === null) {
          // 既に同じペアが存在し削除もされていない＝意図は既に達成されている（冪等に許容）
          return { ok: true };
        }
        // 論理削除済みの行を復元する（新規idでのINSERTは諦め、既存idを蘇らせる）
        const seq = bumpSeq(db, ownerId);
        db.prepare(`UPDATE task_tags SET deleted_at = NULL, updated_at = ?, seq = ? WHERE id = ?`).run(
          op.updated_at,
          seq,
          conflict.id,
        );
        return { ok: true };
      }
    }

    const presentCols = def.columns.filter((c) => fields[c] !== undefined);
    const seq = bumpSeq(db, ownerId);
    const cols = ['id', 'user_id', ...presentCols, 'created_at', 'updated_at', 'deleted_at', 'seq'];
    const values: unknown[] = [
      op.id,
      ownerId,
      ...presentCols.map((c) => fields[c]),
      op.updated_at,
      op.updated_at,
      null,
      seq,
    ];
    const placeholders = cols.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
    // リスト共有（改修22回目）：リスト自体が新規作成された直後に共有されていることは
    // あり得ないが、念のため他テーブルと同じ関数を通るlistsだけ一律で複製呼び出しを揃えておく
    if (table === 'lists') replicateToSharedEditors(db, op.id, 'lists', op.id);
    return { ok: true };
  }

  const shouldApplyFields = op.updated_at >= (existing.updated_at as number);
  const seq = bumpSeq(db, ownerId);

  if (shouldApplyFields) {
    const presentCols = def.columns.filter((c) => fields[c] !== undefined);
    const setClauses = [...presentCols.map((c) => `${c} = ?`), 'updated_at = ?', 'seq = ?'];
    const values: unknown[] = [...presentCols.map((c) => fields[c]), op.updated_at, seq, op.id];
    db.prepare(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  } else {
    db.prepare(`UPDATE ${table} SET seq = ? WHERE id = ?`).run(seq, op.id);
  }

  // リスト自体の変更（名前・色等）を、共有している各editorのpullストリームにも反映する
  // （改修22回目：docs/sync-protocol.md 10章。中身のtasksだけでなくlists行自体も複製対象）
  if (table === 'lists') replicateToSharedEditors(db, op.id, 'lists', op.id);

  return { ok: true };
}

function applyDelete(
  db: Database.Database,
  table: ImplementedSyncTable,
  callerId: string,
  op: SyncOp,
): ApplyResult {
  const existing = fetchExisting(db, table, op.id);
  if (!existing) {
    // 存在しない行への削除は再送や順序ズレで起こり得るため無視（冪等）
    return { ok: true };
  }
  const ownerId = resolveOwnerForExisting(db, table, callerId, existing);
  if (ownerId === null) {
    return { ok: false, reason: 'forbidden' };
  }

  const seq = bumpSeq(db, ownerId);
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
  if (table === 'tasks') {
    replicateToSharedEditors(db, existing.list_id as string, 'tasks', op.id);
  }
  return { ok: true };
}

/**
 * 論理削除の取り消し（ゴミ箱からの復元）。deleted_at を null に戻す点以外は applyDelete と対称。
 * sync-protocol.md には無い拡張のため docs/open-questions.md に記録している。
 */
function applyRestore(
  db: Database.Database,
  table: ImplementedSyncTable,
  callerId: string,
  op: SyncOp,
): ApplyResult {
  const existing = fetchExisting(db, table, op.id);
  if (!existing) {
    // 存在しない行の復元は無意味な操作
    return { ok: false, reason: 'validation_failed' };
  }
  const ownerId = resolveOwnerForExisting(db, table, callerId, existing);
  if (ownerId === null) {
    return { ok: false, reason: 'forbidden' };
  }
  if (existing.deleted_at === null) {
    // 既に復元済み（再送）は冪等に許容する
    return { ok: true };
  }

  const seq = bumpSeq(db, ownerId);
  if (op.updated_at >= (existing.updated_at as number)) {
    db.prepare(`UPDATE ${table} SET deleted_at = NULL, updated_at = ?, seq = ? WHERE id = ?`).run(
      op.updated_at,
      seq,
      op.id,
    );
  } else {
    db.prepare(`UPDATE ${table} SET seq = ? WHERE id = ?`).run(seq, op.id);
  }
  if (table === 'tasks') {
    replicateToSharedEditors(db, existing.list_id as string, 'tasks', op.id);
  }
  return { ok: true };
}

function applyTaskUpsert(
  db: Database.Database,
  callerId: string,
  op: SyncOp,
  fields: Row,
  triggeredByHatch: boolean,
): ApplyResult {
  const existing = fetchExisting(db, 'tasks', op.id);
  const isNewTask = !existing;

  // リスト共有（改修22回目）：既存タスクならowner本人 or acceptedな共有editorか、
  // 新規タスクなら送信先list_idのowner本人 or acceptedな共有editorかを確認し、
  // 以後のseq採番・所有権判定に使う実際のowner user_idを決定する
  let ownerId: string;
  if (existing) {
    const resolved = resolveOwnerForExisting(db, 'tasks', callerId, existing);
    if (resolved === null) return { ok: false, reason: 'forbidden' };
    ownerId = resolved;
  } else {
    const listId = fields.list_id as string | undefined;
    if (!listId) return { ok: false, reason: 'validation_failed' };
    const resolved = resolveEditableListOwner(db, callerId, listId);
    if (resolved === null) return { ok: false, reason: 'forbidden' };
    ownerId = resolved;
  }

  // リスト間移動時、移動先リストのownerが現在のタスクのownerと一致しない場合は拒否する
  // （改修22回目：共有リストのタスクが別ownerのリストへ越境するのを防ぐ。ownerが自分の
  // 別リストへ動かす操作は今まで通り許可される）
  if (fields.list_id !== undefined && fields.list_id !== (existing?.list_id ?? undefined)) {
    const targetListOwnerId = findListOwnerId(db, fields.list_id as string);
    if (targetListOwnerId !== ownerId) {
      return { ok: false, reason: 'forbidden' };
    }
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
    // 親タスクのownerが自分たちのownerと一致するか確認する（改修22回目：他ownerのタスクを
    // 親に指定できてしまう穴を防ぐ。共有導入前から潜在していたが顕在化しやすくなったため追加）
    const parentOwnerId = fetchExisting(db, 'tasks', fields.parent_id as string)?.user_id as string | undefined;
    if (parentOwnerId !== undefined && parentOwnerId !== ownerId) {
      return { ok: false, reason: 'forbidden' };
    }
  }

  if (fields.completed_at !== undefined && fields.completed_at !== null) {
    if (hasIncompleteDescendant(db, op.id)) {
      return { ok: false, reason: 'parent_incomplete' };
    }
  }

  const result = applyUpsert(db, 'tasks', ownerId, op, fields, existing);
  if (!result.ok) return result;

  const finalListId = ('list_id' in fields ? fields.list_id : existing?.list_id) as string;
  replicateToSharedEditors(db, finalListId, 'tasks', op.id);

  const previousCompletedAt = existing?.completed_at ?? null;
  const finalCompletedAt = 'completed_at' in fields ? fields.completed_at : previousCompletedAt;
  // 祖先の完了状態を修復する必要があるのは、このタスクが「新たに未完了の子孫になった」時だけ
  // （新規作成／完了→未完了への遷移／未完了のまま親を付け替え）。既に未完了のタスクの
  // タイトルや優先度などを編集しただけでは、無関係な祖先タスクの完了を巻き戻してはいけない
  const parentChanged = 'parent_id' in fields && fields.parent_id !== (existing?.parent_id ?? null);
  const becameIncompleteDescendant =
    finalCompletedAt === null && (isNewTask || previousCompletedAt !== null || parentChanged);
  if (becameIncompleteDescendant) {
    repairAncestorsCompletion(db, ownerId, op.id);
  }

  if ('due_at' in fields || 'due_date' in fields || 'completed_at' in fields) {
    const finalTitle = ('title' in fields ? fields.title : existing?.title) as string;
    rescheduleDueReminder(
      db,
      ownerId,
      op.id,
      finalTitle,
      finalDueAt as number | null,
      finalDueDate as string | null,
      finalCompletedAt as number | null,
    );
  }

  const finalPriority = ('priority' in fields ? fields.priority : (existing?.priority ?? 0)) as number;
  const taskContext = { id: op.id, list_id: finalListId, priority: finalPriority };

  if (isNewTask) {
    detectTaskEvent(db, ownerId, 'task_created', taskContext, triggeredByHatch);
  }
  const wasCompleting = (existing?.completed_at ?? null) === null && finalCompletedAt !== null;
  if (wasCompleting) {
    detectTaskEvent(db, ownerId, 'task_completed', taskContext, triggeredByHatch);
    detectListAllCompleted(db, ownerId, finalListId, triggeredByHatch);
  }

  recordCompletionForStreak(db, ownerId, op.id, {
    isNewTask,
    wasCompleting,
    finalRrule: ('rrule' in fields ? fields.rrule : (existing?.rrule ?? null)) as string | null,
    finalCompletedAt: finalCompletedAt as number | null,
    dueChanged: 'due_at' in fields || 'due_date' in fields,
    previousDueAt: (existing?.due_at ?? null) as number | null,
    previousDueDate: (existing?.due_date ?? null) as string | null,
    finalDueAt: finalDueAt as number | null,
    finalDueDate: finalDueDate as string | null,
  });

  return { ok: true };
}

/**
 * 習慣トラッキング（ストリーク表示）用の完了ログを記録する（改修5回目）。
 * 通常タスクの完了に加え、繰り返しタスクは`completed_at`を立てず期限を次回分へ
 * 進めるだけの設計（round3の意図的な仕様）のため、「rruleがあるタスクの期限が
 * 完了扱いにはならず未来へ進んだ」ことをもって1回のoccurrence完了とみなす。
 */
function recordCompletionForStreak(
  db: Database.Database,
  userId: string,
  taskId: string,
  ctx: {
    isNewTask: boolean;
    wasCompleting: boolean;
    finalRrule: string | null;
    finalCompletedAt: number | null;
    dueChanged: boolean;
    previousDueAt: number | null;
    previousDueDate: string | null;
    finalDueAt: number | null;
    finalDueDate: string | null;
  },
): void {
  const dueAdvanced =
    (ctx.finalDueAt !== null && (ctx.previousDueAt === null || ctx.finalDueAt > ctx.previousDueAt)) ||
    (ctx.finalDueDate !== null && (ctx.previousDueDate === null || ctx.finalDueDate > ctx.previousDueDate));
  const isRecurrenceOccurrenceCompleted =
    !ctx.isNewTask && ctx.finalRrule !== null && ctx.dueChanged && dueAdvanced && ctx.finalCompletedAt === null;

  if (!ctx.wasCompleting && !isRecurrenceOccurrenceCompleted) return;

  db.prepare('INSERT INTO task_completions (id, user_id, task_id, completed_at) VALUES (?, ?, ?, ?)').run(
    uuidv7(),
    userId,
    taskId,
    Date.now(),
  );
}

/**
 * user_settings は id を持たず PK が user_id 自体で、deleted_at も無い（1ユーザー1行、論理削除の概念がない）
 * ため、他テーブルと違う専用ロジックで扱う。op.id にはクライアントが自分の user_id を指定する。
 */
function applyUserSettingsOp(db: Database.Database, userId: string, op: SyncOp): ApplyResult {
  if (op.id !== userId) {
    return { ok: false, reason: 'forbidden' };
  }
  if (op.op === 'delete' || op.op === 'restore') {
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
      'INSERT INTO user_settings (user_id, theme, keymap_json, weather_location_json, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      userId,
      (fields.theme as string | undefined) ?? 'light',
      (fields.keymap_json as string | undefined) ?? '{}',
      (fields.weather_location_json as string | undefined) ?? '{}',
      op.updated_at,
      seq,
    );
    return { ok: true };
  }

  const shouldApplyFields = op.updated_at >= (existing.updated_at as number);
  const seq = bumpSeq(db, userId);

  if (shouldApplyFields) {
    const presentCols = ['theme', 'keymap_json', 'weather_location_json'].filter((c) => fields[c] !== undefined);
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
