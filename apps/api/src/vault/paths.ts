import fs from 'node:fs';
import path from 'node:path';

export type VaultErrorCode = 'not_found' | 'conflict' | 'invalid' | 'exists';

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Obsidianの[[リンク]]を壊す文字と、Windows/macOSでファイル名に使えない文字（docs/vault-spec.md 3章） */
// eslint-disable-next-line no-control-regex
const INVALID_TITLE_CHARS = /[\\/:*?"<>|#^[\]\u0000-\u001f]/;

/** タイトルとして使えなければ理由を返す */
export function validateTitle(title: string): string | null {
  if (title.trim() === '') return 'タイトルが空です';
  if (title !== title.trim()) return 'タイトルの前後に空白は使えません';
  if (title.startsWith('.')) return 'タイトルを「.」で始めることはできません';
  if (INVALID_TITLE_CHARS.test(title)) return 'タイトルに使えない文字（\\ / : * ? " < > | # ^ [ ]）が含まれています';
  if (title.length > 200) return 'タイトルが長すぎます';
  return null;
}

/**
 * Vault内の相対パス（posix区切り）を正規化する。`.md`が無ければ付ける。
 * Vault外を指すパス（絶対パス・`..`）は拒否する。
 */
export function normalizeNotePath(rel: string): string {
  const p = normalizeRelPath(rel);
  return p.endsWith('.md') ? p : `${p}.md`;
}

export function normalizeRelPath(rel: string): string {
  const trimmed = rel.trim().replace(/\\/g, '/');
  if (trimmed === '' || trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) {
    throw new VaultError('invalid', `不正なパスです: ${rel}`);
  }
  const normalized = path.posix.normalize(trimmed);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new VaultError('invalid', `Vault外を指すパスは使えません: ${rel}`);
  }
  return normalized.replace(/\/$/, '');
}

/**
 * 相対パスをVaultルート配下の絶対パスに解決する。シンボリックリンク経由でVault外へ出る場合も拒否する
 * （存在する最も深い祖先をrealpathで解決して確認する）。
 */
export function resolveInVault(root: string, rel: string): string {
  const abs = path.resolve(root, normalizeRelPath(rel));
  // ルートが未作成だと祖先側だけrealpath解決されて比較がずれる（macOSの/var→/private/var等）ため先に作る
  fs.mkdirSync(root, { recursive: true });
  const rootReal = fs.realpathSync(root);

  let probe = abs;
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  const probeReal = fs.existsSync(probe) ? fs.realpathSync(probe) : probe;
  if (probeReal !== rootReal && !probeReal.startsWith(rootReal + path.sep)) {
    throw new VaultError('invalid', `Vault外を指すパスは使えません: ${rel}`);
  }
  return abs;
}

/** `projects/Nestio/Nestio.md` → `Nestio` */
export function titleFromPath(rel: string): string {
  return path.posix.basename(rel).replace(/\.md$/, '');
}
