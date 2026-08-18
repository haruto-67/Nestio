import type Database from 'better-sqlite3';
import { uuidv7, type SyncOp } from '@nestio/shared';
import type { Env } from '../../env.js';
import type { Logger } from '../../logger.js';
import { runClaudePrompt } from '../claude-runner.js';
import { expandTemplate } from '../template.js';
import { applySyncOps } from '../../sync/apply.js';
import { runCreateNote } from './internal.js';
import { sendPushToUser } from '../../push/sender.js';

function requireClaudeConfigured(env: Env): void {
  if (!env.CLAUDE_BIN || !env.CLAUDE_WORKDIR) {
    throw new Error('CLAUDE_BIN/CLAUDE_WORKDIR is not configured (docs/manual-setup.md D-1)');
  }
}

export async function runClaudePromptAction(
  db: Database.Database,
  env: Env,
  logger: Logger,
  userId: string,
  subjectTaskId: string | null,
  params: { template: string; output: 'note' | 'push' },
): Promise<string> {
  requireClaudeConfigured(env);

  const prompt = await expandTemplate(db, params.template, subjectTaskId, userId);
  const result = await runClaudePrompt(prompt, {
    bin: env.CLAUDE_BIN,
    workdir: env.CLAUDE_WORKDIR,
    timeoutSec: env.CLAUDE_TIMEOUT_SEC,
  });

  if (params.output === 'note') {
    await runCreateNote(db, userId, subjectTaskId, { title_template: 'Claudeの応答', body_template: result.stdout });
  } else {
    await sendPushToUser(db, env, logger, userId, { title: 'Claudeからの応答', body: result.stdout.slice(0, 200) });
  }

  return result.stdout;
}

export async function runClaudeSubtasks(
  db: Database.Database,
  env: Env,
  userId: string,
  subjectTaskId: string | null,
  params: { max_count: number },
): Promise<{ created: number }> {
  requireClaudeConfigured(env);
  if (!subjectTaskId) throw new Error('subject task is required for claude_subtasks');

  const task = db.prepare('SELECT title, list_id FROM tasks WHERE id = ?').get(subjectTaskId) as
    | { title: string; list_id: string }
    | undefined;
  if (!task) throw new Error('task not found');

  const prompt = `次のタスクを${params.max_count}件以下のサブタスクに分解してください。1行に1つ、タスク名のみを出力してください。\nタスク: ${task.title}`;
  const result = await runClaudePrompt(prompt, {
    bin: env.CLAUDE_BIN,
    workdir: env.CLAUDE_WORKDIR,
    timeoutSec: env.CLAUDE_TIMEOUT_SEC,
  });

  const lines = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, params.max_count);

  lines.forEach((line, i) => {
    const op: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: uuidv7(),
      op: 'upsert',
      updated_at: Date.now(),
      fields: { list_id: task.list_id, parent_id: subjectTaskId, title: line, sort_order: i + 1 },
    };
    const res = applySyncOps(db, userId, [op], { triggeredByHatch: true });
    if (res.rejected.length > 0) throw new Error(`subtask rejected: ${res.rejected[0]?.reason}`);
  });

  return { created: lines.length };
}
