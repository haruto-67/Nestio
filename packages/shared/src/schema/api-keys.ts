import { z } from 'zod';
import { idSchema, epochMsSchema } from './common.js';
import { oauthScopeSchema } from './oauth.js';

/**
 * 「API化」機能（改修22回目）：MCP（OAuth 2.1）とは別に、外部スクリプトやZapier等の
 * サービス連携から手軽に叩ける個人用APIキー認証。設定画面から発行・失効する。
 * key_hashは平文キーのSHA-256ハッシュで、クライアントへは返さない（一覧APIのレスポンスにも含めない）
 */
export const apiKeyRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  name: z.string().min(1),
  /** スペース区切りの "read" / "read write"（oauth_tokensと同じ形式）、またはダッシュボード専用の "dashboard"（改修26回目） */
  scope: z.string(),
  last_used_at: epochMsSchema.nullable(),
  created_at: epochMsSchema,
  revoked_at: epochMsSchema.nullable(),
});
export type ApiKeyRow = z.infer<typeof apiKeyRowSchema>;

/**
 * 'dashboard' は iPad 常時表示ダッシュボード用（改修26回目）。今日のタスクとポモドーロ状態の
 * 読み取り（/api/v1/dashboard・/api/v1/pomodoro/current）だけに使え、/api/v1/public/ は叩けない
 */
export const apiKeyScopeRequestSchema = z.union([oauthScopeSchema, z.literal('dashboard')]);
export type ApiKeyScopeRequest = z.infer<typeof apiKeyScopeRequestSchema>;

export const apiKeyCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  scope: apiKeyScopeRequestSchema.default('read'),
});
export type ApiKeyCreateRequest = z.infer<typeof apiKeyCreateRequestSchema>;

// ---- iPad ダッシュボード向け読み取り API（改修26回目、docs/api-spec.md） ----

export interface DashboardTodayTask {
  id: string;
  title: string;
  /** 時刻指定ありの期限（ISO 8601、+09:00）。終日タスクは null */
  due_at: string | null;
  /** 終日タスクの日付（YYYY-MM-DD）。時刻指定ありは null */
  due_date: string | null;
  done: boolean;
  completed_at: string | null;
  list_id: string;
  overdue: boolean;
}

export interface DashboardToday {
  /** 集計の基準日（Asia/Tokyo の YYYY-MM-DD） */
  date: string;
  done_count: number;
  total_count: number;
  tasks: DashboardTodayTask[];
}

export interface DashboardPomodoro {
  task_id: string | null;
  task_title: string | null;
  phase: 'focus' | 'break';
  started_at: string;
  ends_at: string;
  duration_sec: number;
  /** Nestio のポモドーロは単発のタイマーでラウンドの概念が無いため常に null */
  round: number | null;
  total_rounds: number | null;
  next_break_min: number | null;
  /** 一時停止の機能が無いため常に false（「中断」は停止扱いで、その時点で null になる） */
  paused: boolean;
}

export interface DashboardResponse {
  generated_at: string;
  today: DashboardToday;
  pomodoro: DashboardPomodoro | null;
}
