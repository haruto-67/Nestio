import zlib from 'node:zlib';

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

/**
 * PNGの各チャンクのCRC32を検証する（改修16回目：MCP経由でdata URIのbase64をnote/bodyに直書き
 * していた際、1万文字を超える巨大な文字列をツール呼び出しの引数として生成する過程でごく低い
 * 確率で1文字だけ化け、マジックバイト（先頭8バイト）の検証だけではすり抜けてしまい、
 * 「画像がスペースだけで何も表示されない」という沈黙した破損として発覚した問題への対応）。
 * PNG仕様上、各チャンクはtype+dataに対するCRC32を末尾に持つため、1バイトの破損でも高確率で検出できる。
 * JPEG/WebP/GIFにはPNGのような全チャンクCRCの仕組みが無いため、当面PNGのみ検証する。
 */
export function verifyPngIntegrity(buf: Buffer): boolean {
  let offset = 8; // PNGシグネチャ（8バイト）の直後から
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const typeAndDataEnd = offset + 8 + length;
    const crcEnd = typeAndDataEnd + 4;
    if (crcEnd > buf.length) return false;

    const typeAndData = buf.subarray(offset + 4, typeAndDataEnd);
    const expectedCrc = buf.readUInt32BE(typeAndDataEnd);
    if ((zlib.crc32(typeAndData) >>> 0) !== expectedCrc) return false;

    if (typeAndData.subarray(0, 4).toString('ascii') === 'IEND') return true;
    offset = crcEnd;
  }
  return false;
}

/** マジックバイト検証に加え、対応形式ではデータの完全性（CRC等）も検証する */
export function verifyImageIntegrity(buf: Buffer, mime: string): boolean {
  if (mime === 'image/png') return verifyPngIntegrity(buf);
  return true;
}
