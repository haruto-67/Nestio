import type Database from 'better-sqlite3';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import * as internalActions from './actions/internal.js';
import * as notifyActions from './actions/notify.js';
import { runRegisteredScript } from './actions/scripts.js';
import * as claudeActions from './actions/claude.js';

interface TriggerForRun {
  action_key: string;
  params_json: string;
}

/**
 * アクション実装は内部操作系 → 通知系 → claude_prompt系の順（api-spec.md 7章）。
 * 戻り値は trigger_runs.output に保存する実行結果の文字列。
 */
export async function runHatchAction(
  db: Database.Database,
  env: Env,
  logger: Logger,
  userId: string,
  subjectId: string | null,
  trigger: TriggerForRun,
): Promise<string> {
  const params = JSON.parse(trigger.params_json || '{}') as Record<string, unknown>;

  switch (trigger.action_key) {
    case 'add_tag': {
      if (!subjectId) throw new Error('subject task is required');
      internalActions.runAddTag(db, userId, subjectId, params as { tag_id: string });
      return 'tag added';
    }
    case 'set_priority': {
      if (!subjectId) throw new Error('subject task is required');
      internalActions.runSetPriority(db, userId, subjectId, params as { priority: 0 | 1 | 2 | 3 });
      return 'priority updated';
    }
    case 'move_to_list': {
      if (!subjectId) throw new Error('subject task is required');
      internalActions.runMoveToList(db, userId, subjectId, params as { list_id: string });
      return 'moved';
    }
    case 'create_task': {
      const id = internalActions.runCreateTask(
        db,
        userId,
        subjectId,
        params as { list_id: string; title_template: string; due_offset_days?: number },
      );
      return `created task ${id}`;
    }
    case 'create_note': {
      const id = internalActions.runCreateNote(
        db,
        userId,
        subjectId,
        params as { title_template: string; body_template: string },
      );
      return `created note ${id}`;
    }

    case 'push_notify':
      await notifyActions.runPushNotify(db, env, logger, userId, params as { title: string; body: string });
      return 'push sent';
    case 'discord_notify':
      await notifyActions.runDiscordNotify(
        db,
        env,
        subjectId,
        params as { webhook_key: string; message_template: string },
      );
      return 'discord sent';
    case 'run_registered_script':
      return await runRegisteredScript(env, params as { script_key: string });

    case 'claude_prompt':
      return await claudeActions.runClaudePromptAction(
        db,
        env,
        logger,
        userId,
        subjectId,
        params as { template: string; output: 'note' | 'push' },
      );
    case 'claude_subtasks': {
      const result = await claudeActions.runClaudeSubtasks(db, env, userId, subjectId, params as { max_count: number });
      return `created ${result.created} subtasks`;
    }

    default:
      throw new Error(`unsupported action: ${trigger.action_key}`);
  }
}
