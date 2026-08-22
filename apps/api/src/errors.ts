import { ERROR_STATUS, type ErrorCode } from '@nestio/shared';

/** ルートハンドラから投げる想定のエラー。onErrorでApiErrorBody形式に変換される */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** 呼び出し側が次の一手を判断するための追加情報（例: 再試行の残り回数）。改修19回目 */
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}
