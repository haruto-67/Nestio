/**
 * クライアント申告のContent-Typeを信用せず、実バイト列（マジックバイト）で実体形式を検証する。
 * クライアント側は長辺1600px・WebPへ変換して送る想定だが、iOS Safariの古いバージョン等
 * WebP非対応環境へのフォールバックも考慮しJPEG/PNG/GIFも許容する。
 */
const SIGNATURES: { mime: string; check: (buf: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    check: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    check: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  {
    mime: 'image/gif',
    check: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) &&
      b[5] === 0x61,
  },
];

/** 検出できた実体のMIMEタイプ。画像以外（またはどの既知形式にも一致しない場合）はnull */
export function detectImageMime(buf: Buffer): string | null {
  for (const sig of SIGNATURES) {
    if (sig.check(buf)) return sig.mime;
  }
  return null;
}
