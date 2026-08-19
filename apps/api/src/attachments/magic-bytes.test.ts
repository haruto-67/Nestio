import { describe, expect, it } from 'vitest';
import { detectImageMime, verifyPngIntegrity, verifyImageIntegrity } from './magic-bytes.js';

// 1x1の黒PNG（改修16回目：整合性検証のテスト用固定データ）
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('detectImageMime', () => {
  it('JPEGを検出する', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageMime(buf)).toBe('image/jpeg');
  });

  it('PNGを検出する', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(detectImageMime(buf)).toBe('image/png');
  });

  it('WebPを検出する', () => {
    const buf = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary');
    expect(detectImageMime(buf)).toBe('image/webp');
  });

  it('GIFを検出する', () => {
    const buf = Buffer.from('GIF89a', 'binary');
    expect(detectImageMime(buf)).toBe('image/gif');
  });

  it('画像でないデータはnullを返す（実行ファイル等のなりすまし対策）', () => {
    const buf = Buffer.from('#!/bin/sh\necho hello');
    expect(detectImageMime(buf)).toBeNull();
  });

  it('空バッファはnullを返す', () => {
    expect(detectImageMime(Buffer.alloc(0))).toBeNull();
  });
});

// 改修16回目：MCP経由のdata URI直書きで、長大なbase64文字列がツール呼び出し引数の生成過程で
// ごく低い確率で1文字化けし、マジックバイトだけの検証をすり抜けて「画像が表示されない」形で
// 沈黙して壊れる問題が発覚した。PNGの各チャンクのCRC32を検証してこれを検出する
describe('verifyPngIntegrity', () => {
  it('正常なPNGはtrueを返す', () => {
    expect(verifyPngIntegrity(TINY_PNG)).toBe(true);
  });

  it('途中の1バイトが化けたPNGはfalseを返す（CRC不一致）', () => {
    const broken = Buffer.from(TINY_PNG);
    broken[30] = (broken[30] ?? 0) ^ 0xff;
    expect(verifyPngIntegrity(broken)).toBe(false);
  });

  it('途中で切れた（truncateされた）PNGはfalseを返す', () => {
    const truncated = TINY_PNG.subarray(0, TINY_PNG.length - 10);
    expect(verifyPngIntegrity(truncated)).toBe(false);
  });
});

describe('verifyImageIntegrity', () => {
  it('PNGはCRC検証を行う', () => {
    const broken = Buffer.from(TINY_PNG);
    broken[30] = (broken[30] ?? 0) ^ 0xff;
    expect(verifyImageIntegrity(broken, 'image/png')).toBe(false);
  });

  it('PNG以外の形式はCRCの仕組みが無いため検証をスキップしtrueを返す', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(verifyImageIntegrity(buf, 'image/jpeg')).toBe(true);
  });
});
