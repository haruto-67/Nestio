const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/**
 * RFC 9562 UUIDv7 生成。先頭48bitがミリ秒精度のUnix時刻のため、
 * 文字列比較だけで生成順にソートできる（オフライン採番したIDをそのままPKにできる）。
 */
export function uuidv7(): string {
  const unixTsMs = BigInt(Date.now());
  const bytes = new Uint8Array(16);

  bytes[0] = Number((unixTsMs >> 40n) & 0xffn);
  bytes[1] = Number((unixTsMs >> 32n) & 0xffn);
  bytes[2] = Number((unixTsMs >> 24n) & 0xffn);
  bytes[3] = Number((unixTsMs >> 16n) & 0xffn);
  bytes[4] = Number((unixTsMs >> 8n) & 0xffn);
  bytes[5] = Number(unixTsMs & 0xffn);

  const rand = crypto.getRandomValues(new Uint8Array(10));

  bytes[6] = 0x70 | ((rand[0] ?? 0) & 0x0f); // version 7
  bytes[7] = rand[1] ?? 0;
  bytes[8] = 0x80 | ((rand[2] ?? 0) & 0x3f); // variant 10
  bytes[9] = rand[3] ?? 0;
  bytes[10] = rand[4] ?? 0;
  bytes[11] = rand[5] ?? 0;
  bytes[12] = rand[6] ?? 0;
  bytes[13] = rand[7] ?? 0;
  bytes[14] = rand[8] ?? 0;
  bytes[15] = rand[9] ?? 0;

  let out = '';
  for (let i = 0; i < 16; i++) {
    out += HEX[bytes[i] ?? 0];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
