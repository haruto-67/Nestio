import { describe, expect, it } from 'vitest';
import { normalizeKeyCombo, normalizeKeyComboUnified } from './keymap.js';

function fakeEvent(
  overrides: Partial<Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>>,
): KeyboardEvent {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('normalizeKeyCombo', () => {
  // 改修13回目（Claude所感）：US配列でCtrl+Shift+1を押すとe.keyは"1"ではなく"!"になる
  // （ブラウザがShift併用時の生成文字を渡すため）。DEFAULT_KEYMAPのpriority_none等
  // （Ctrl+Shift+1〜4）はこのズレにより実際には一度も発火しないバグになっていた。
  // e.codeベースの物理キー判定に切り替えたことで、レイアウトに依らず"1"に正規化される
  it('Ctrl+Shift+Digit1はe.keyが"!"でもCtrl+Shift+1に正規化される', () => {
    const e = fakeEvent({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(normalizeKeyCombo(e)).toBe('Ctrl+Shift+1');
  });

  it('Ctrl+Shift+Slashはe.keyが"?"でもCtrl+Shift+/に正規化される（show_helpの既定値）', () => {
    const e = fakeEvent({ key: '?', code: 'Slash', ctrlKey: true, shiftKey: true });
    expect(normalizeKeyCombo(e)).toBe('Ctrl+Shift+/');
  });

  it('アルファベットキーはe.keyをそのまま小文字化して使う', () => {
    const e = fakeEvent({ key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true });
    expect(normalizeKeyCombo(e)).toBe('Ctrl+Shift+n');
  });

  it('スペースキーはSpaceに正規化される', () => {
    const e = fakeEvent({ key: ' ', code: 'Space' });
    expect(normalizeKeyCombo(e)).toBe('Space');
  });

  it('CtrlとCmdを区別する', () => {
    const ctrlEvent = fakeEvent({ key: 'k', code: 'KeyK', ctrlKey: true });
    const cmdEvent = fakeEvent({ key: 'k', code: 'KeyK', metaKey: true });
    expect(normalizeKeyCombo(ctrlEvent)).toBe('Ctrl+k');
    expect(normalizeKeyCombo(cmdEvent)).toBe('Cmd+k');
  });
});

describe('normalizeKeyComboUnified', () => {
  it('CtrlとCmdをどちらも"Ctrl"として扱う', () => {
    const ctrlEvent = fakeEvent({ key: 'k', code: 'KeyK', ctrlKey: true });
    const cmdEvent = fakeEvent({ key: 'k', code: 'KeyK', metaKey: true });
    expect(normalizeKeyComboUnified(ctrlEvent)).toBe('Ctrl+k');
    expect(normalizeKeyComboUnified(cmdEvent)).toBe('Ctrl+k');
  });

  it('数字キーもe.codeベースで正規化される', () => {
    const e = fakeEvent({ key: '@', code: 'Digit2', ctrlKey: true, shiftKey: true });
    expect(normalizeKeyComboUnified(e)).toBe('Ctrl+Shift+2');
  });
});
