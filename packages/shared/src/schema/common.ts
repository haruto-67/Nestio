import { z } from 'zod';

/** UUIDv7を含む一般的なUUID文字列（クライアント採番のIDに使用） */
export const idSchema = z.string().uuid();

/** epochミリ秒（UTC）。0以上の整数 */
export const epochMsSchema = z.number().int().nonnegative();

/** 終日タスクの日付。時刻・タイムゾーン変換の対象外 */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD形式である必要があります');

/** サーバーが採番する同期カーソル値 */
export const seqSchema = z.number().int().positive();

/** 手動並び替え用の順序値。小数を挟めるようREALで持つ */
export const sortOrderSchema = z.number();

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'カラーコードは#RRGGBB形式である必要があります');
