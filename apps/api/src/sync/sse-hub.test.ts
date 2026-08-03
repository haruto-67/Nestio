import { describe, expect, it } from 'vitest';
import { subscribeSse, broadcastBump } from './sse-hub.js';

describe('sse-hub', () => {
  it('購読中のクライアントにbumpを配信する', () => {
    const received: string[] = [];
    const unsubscribe = subscribeSse('user-1', { push: (payload) => received.push(payload) });

    broadcastBump('user-1', 42, 'device-a');

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0] as string)).toEqual({ seq: 42, origin_device: 'device-a' });

    unsubscribe();
  });

  it('購読解除後は配信されない', () => {
    const received: string[] = [];
    const unsubscribe = subscribeSse('user-2', { push: (payload) => received.push(payload) });
    unsubscribe();

    broadcastBump('user-2', 1, 'device-a');

    expect(received).toHaveLength(0);
  });

  it('別ユーザー宛のbumpは配信されない', () => {
    const received: string[] = [];
    const unsubscribe = subscribeSse('user-3', { push: (payload) => received.push(payload) });

    broadcastBump('user-4', 1, 'device-a');

    expect(received).toHaveLength(0);
    unsubscribe();
  });

  it('購読者がいなくても例外にならない', () => {
    expect(() => broadcastBump('nobody', 1, 'device-a')).not.toThrow();
  });
});
