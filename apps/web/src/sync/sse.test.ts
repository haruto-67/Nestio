import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { connectSse } from './sse.js';

vi.mock('./log-buffer.js', () => ({ logClientEvent: vi.fn() }));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data = '') {
    for (const fn of this.listeners.get(type) ?? []) fn({ data } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

describe('connectSse の死活監視（改修26回目）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pingが届いている間は張り直さない', () => {
    const stop = connectSse({ onConnect: vi.fn(), onBump: vi.fn() });
    const es = FakeEventSource.instances[0]!;
    es.onopen?.();
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(30_000);
      es.emit('ping');
    }
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es.closed).toBe(false);
    stop();
  });

  it('bumpもpingも途絶えたら死んだ接続とみなして張り直し、接続時のpullが走る', () => {
    const onConnect = vi.fn();
    const stop = connectSse({ onConnect, onBump: vi.fn() });
    const first = FakeEventSource.instances[0]!;
    first.onopen?.();
    expect(onConnect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(90_000);
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances[1]!.onopen?.();
    expect(onConnect).toHaveBeenCalledTimes(2);
    stop();
  });

  it('停止後は監視タイマーも止まる', () => {
    const stop = connectSse({ onConnect: vi.fn(), onBump: vi.fn() });
    stop();
    vi.advanceTimersByTime(300_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
