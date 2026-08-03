import { ERROR_STATUS, type ErrorCode } from '@nestio/shared';

/** ルートハンドラから投げる想定のエラー。onErrorでApiErrorBody形式に変換される */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}
