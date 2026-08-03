import { describe, expect, it } from 'vitest';
import { detectImageMime } from './magic-bytes.js';

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
