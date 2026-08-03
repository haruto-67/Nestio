export interface SseClient {
  push: (payload: string) => void;
}

const clients = new Map<string, Set<SseClient>>();

/** ユーザーのSSE接続を登録する。戻り値の関数で購読解除する */
export function subscribeSse(userId: string, client: SseClient): () => void {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(client);

  return () => {
    const current = clients.get(userId);
    current?.delete(client);
    if (current && current.size === 0) clients.delete(userId);
  };
}

/** sync-protocol.md 7章：ペイロードはseqのみ。実データはクライアントがpullで取りに行く */
export function broadcastBump(userId: string, seq: number, originDevice: string): void {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({ seq, origin_device: originDevice });
  for (const client of set) {
    client.push(payload);
  }
}
