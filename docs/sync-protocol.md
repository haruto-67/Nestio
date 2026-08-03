# Nestio 同期プロトコル仕様

自動生成で最も壊れやすい箇所のため、実装の自由度を意図的に潰している。
**この文書に書かれた方式以外で実装しないこと。**

## 0. 全体像

```
[UI] ──読み書き──> [IndexedDB]  ← これが唯一の真実（UI は常にここだけを見る）
                       │
                   [outbox]  未送信の操作キュー
                       │
                    push ↓ ↑ pull
                    [API / SQLite]
                       │
                    [SSE] "seq が進んだ" とだけ通知 → クライアントが pull
```

**原則**

1. UI は絶対にネットワークを待たない。書き込みは IndexedDB に入れた時点で完了扱い
2. サーバーは**信頼できる唯一の順序（seq）**を持つ。クライアントはそれを追いかけるだけ
3. SSE はデータを運ばない。「新しい変更がある」という合図だけを送り、実データは pull で取る
   - 差分を SSE で直接流すと、切断中の取りこぼしと再接続時の重複処理を両方扱う羽目になる

## 1. ID 採番

- **すべての ID はクライアントが UUIDv7 で採番する**
- サーバー側の AUTOINCREMENT は使わない（オフラインで作成した行に ID が必要なため）
- UUIDv7 は先頭が時刻順のため、そのままソートに使え、インデックスの断片化も少ない
- `op_id`（操作 ID）も同じく UUIDv7

## 2. seq（同期カーソル）

- `sync_state.last_seq` はユーザーごとの単調増加カウンタ
- **サーバーが行を書き込むたびに +1 し、その値を行の `seq` に入れる**
- クライアントは「自分が持っている最大の seq」を記録し、次回はそれ以降だけを要求する
- 採番と行の書き込みは**必ず同一トランザクション内**で行う

```sql
UPDATE sync_state SET last_seq = last_seq + 1 WHERE user_id = ?;
SELECT last_seq FROM sync_state WHERE user_id = ?;   -- これを行の seq に使う
```

## 3. Pull（サーバー → クライアント）

```
GET /api/v1/sync/pull?since=<seq>&limit=500
```

**レスポンス**

```jsonc
{
  "changes": {
    "folders":     [ /* 行そのまま */ ],
    "lists":       [],
    "tasks":       [],
    "tags":        [],
    "task_tags":   [],
    "notes":       [],
    "attachments": [],
    "triggers":    []
  },
  "next_seq": 1042,
  "has_more": false
}
```

- 各テーブルから `user_id = ? AND seq > since ORDER BY seq LIMIT ?` で取得
- **削除は行が消えるのではなく `deleted_at` が入った行として届く**（tombstone）
- `has_more` が true の間、クライアントは `since = next_seq` で繰り返す
- 初回同期は `since=0`

## 4. Push（クライアント → サーバー）

```
POST /api/v1/sync/push
```

```jsonc
{
  "device_id": "01912f...",
  "ops": [
    {
      "op_id": "01912f8c-...",       // UUIDv7。再送しても同じ値
      "table": "tasks",
      "id": "01912f8a-...",          // 対象行の ID
      "op": "upsert",                // "upsert" | "delete"
      "updated_at": 1754200000000,   // クライアントの時刻（epoch ms）
      "fields": { "title": "買い物", "priority": 2 }
    }
  ]
}
```

**レスポンス**

```jsonc
{
  "applied":  ["01912f8c-..."],
  "rejected": [ { "op_id": "...", "reason": "cycle_detected" } ],
  "next_seq": 1043
}
```

### 適用ルール（サーバー側）

ops は**配列の順番どおりに、1 リクエスト 1 トランザクション**で処理する。

```
for op in ops:
    # 1. 冪等性チェック
    if applied_ops に op.op_id が存在する:
        applied に加えてスキップ        # 再送。二重適用しない

    # 2. 所有権チェック
    行が既に存在し user_id が一致しない → reject("forbidden")

    # 3. 衝突解決（フィールド単位 LWW）
    if 既存行が存在:
        if op.updated_at <  既存.updated_at            → このフィールドは捨てる
        if op.updated_at == 既存.updated_at:
            device_id の辞書順が大きい方を採用          # 決定的なタイブレーク
        else                                          → 上書き
    else:
        INSERT

    # 4. バリデーション（後述）

    # 5. seq を採番して行に書き込む

    # 6. applied_ops に op_id を記録
```

- **LWW はフィールド単位**。`fields` に含まれるキーだけを比較・上書きする
  - デバイス A がタイトル、デバイス B が優先度を変えた場合、両方が残る
- `delete` は `deleted_at` に時刻を入れるだけ（物理削除しない）

### 時計のずれ

- `updated_at` はクライアントの時計に依存する
- サーバーは受信時に `|client_now - server_now| > 5分` を検出したら
  レスポンスに `clock_skew_ms` を返し、**クライアントは以後この補正値を加算して updated_at を作る**
- 端末の時計が大きく狂っていると新しい変更が古いもので上書きされ得るため、この補正は必須

## 5. バリデーション（サーバーが必ず拒否するもの）

| チェック | 理由 |
|---|---|
| `parent_id` の循環参照 | 祖先を辿って自分に戻るなら reject。放置すると `WITH RECURSIVE` が無限ループする |
| 親タスクの完了 | 未完了の子孫が 1 つでもあれば `completed_at` の設定を reject |
| 親子の矛盾 | 同期の結果、完了済み親に未完了の子ができた場合は**親を未完了に戻す**（サーバー主導で修復） |
| `due_at` と `due_date` の同時指定 | 排他。CHECK 制約でも防いでいる |
| 添付の総容量 | ユーザー上限を超えたら reject |

## 6. 削除と GC（cron / 日次）

| 対象 | 保持期間 | 処理 |
|---|---|---|
| `deleted_at` の付いた行 | **30 日** | 物理削除。放置すると tombstone が無限に増える |
| `applied_ops` | 30 日 | 物理削除 |
| 添付ファイルの実体 | 参照ゼロになってから 30 日 | `sha256` の参照カウントを数えてから削除 |

**注意**：クライアントが 30 日以上オフラインだった場合、tombstone を取りこぼす。
そのため `since` がサーバーの GC 済み境界より古い場合、サーバーは
`{"full_resync_required": true}` を返し、**クライアントはローカル DB を捨てて `since=0` からやり直す**。
このとき outbox は捨てず、先に push を完了させてから resync する。

## 7. SSE

```
GET /api/v1/sync/stream
```

```
event: bump
data: {"seq": 1043, "origin_device": "01912f..."}
```

- ペイロードは seq のみ。受信したクライアントは自分の seq より大きければ pull を実行
- `origin_device` が自分なら無視（自分の書き込みの反響）
- 切断時は指数バックオフで再接続。**再接続時は必ず pull を 1 回走らせる**（切断中の取りこぼし回収）
- nginx では SSE 用に `proxy_buffering off;` と `proxy_read_timeout 3600s;` が必要

## 8. Outbox（クライアント側）

- IndexedDB の `outbox` ストアに操作を append する
- 送信は FIFO。**1 回の push は最大 200 ops**
- 成功したら outbox から削除。失敗（ネットワーク）なら残す
- `rejected` が返ってきた op は outbox から削除し、**pull で正しい状態を取り直す**
- 同一行に対する連続した upsert は送信直前にマージしてよい（op_id は最後のものを使う）
- **オンライン復帰時の順序：push → pull**。逆にするとローカルの未送信変更がサーバー値で潰される

## 9. 添付ファイル

- バイナリは同期プロトコルに乗せない。`attachments` はメタデータ行としてのみ同期する
- 実体は別エンドポイントで転送する
  1. クライアントで縮小・変換 → SHA-256 を計算
  2. `POST /api/v1/attachments/{sha256}` でアップロード（既に存在すれば 200 で即終了）
  3. 成功後に `attachments` 行を push
- **順序が逆になると、メタデータだけあって実体がない状態が発生する**
- バイナリは content-addressed で不変のため、衝突解決は不要

## 10. テストで必ず確認すること

- [ ] 機内モードで作成 → 復帰 → 別デバイスに反映される
- [ ] 同じ op を 2 回 push しても行が重複しない
- [ ] 2 デバイスで別フィールドを同時編集 → 両方残る
- [ ] 2 デバイスで同じフィールドを同時編集 → 決定的に片方に収束する
- [ ] デバイス A で「X を Y の下へ」、B で「Y を X の下へ」 → 片方が reject され循環しない
- [ ] 完了済み親に未完了の子が同期されてきた → 親が未完了に戻る
- [ ] 31 日オフラインだった端末 → `full_resync_required` で復帰し、未送信分が失われない
