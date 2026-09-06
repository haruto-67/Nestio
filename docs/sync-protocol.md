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
      "op": "upsert",                // "upsert" | "delete" | "restore"（restoreは改修1回目で追加）
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
- **`base_fields`（改修5回目で追加、任意）**：`tasks.note` / `notes.body` の2フィールドに限り、
  op に `base_fields: { note: "..." }` のように「クライアントが編集を開始した時点で見ていた値」を
  添えられる。サーバーは現在のDB値と`base_fields`を比較し、
  - 一致する（他デバイスがその間に書き換えていない）→ 通常どおり`fields`の値でLWW上書き
  - 食い違う（自分の知らない間に他デバイスが同じフィールドを書き換えていた＝真の同時編集）→
    LWW上書きはせず、両方の内容をgit風のコンフリクトマーカー（`<<<<<<< 相手の変更` /
    `=======` / `>>>>>>> あなたの変更`）で連結した文字列を保存する
  - `base_fields`を送らない（旧クライアント・対象外テーブル）場合は従来どおり単純なLWW
  - 実装は`apps/api/src/sync/apply.ts`の`resolveFieldMergeConflict`。この関数以外のフィールドは
    従来どおりフィールド単位LWWのみで、3-wayマージの対象ではない
- `delete` は `deleted_at` に時刻を入れるだけ（物理削除しない）
- `restore`（改修1回目でゴミ箱機能のため追加）は `delete` と対称に `deleted_at` を `NULL` へ戻すだけ。
  `delete` 同様 `op.updated_at >= 既存行.updated_at` の場合のみ適用し、`user_settings` には無い
  （そもそも `deleted_at` を持たない）。存在しない行への `restore` は無意味な操作として reject する
  （`delete` が冪等に無視するのとは異なる点に注意）

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

## 10. リスト共有（改修22回目）

リスト単位で他ユーザーに編集権限を付与する機能。**「1ユーザー1系列のseq」という2章の原則は変えない**。
共有先（editor）も自分自身の`sync_state`だけを見て通常のpullを完結できるよう、
owner側の変更を各editorの系列へ"複製"する方式にする。

### 招待

- `list_shares(id, list_id, owner_user_id, invited_user_id, invited_email, status, created_at, accepted_at, deleted_at)`
- 招待は既存ユーザー（`email_verified`済みでNestioに登録済み）のメールアドレス指定のみ。新規ユーザー招待は非対応
- `status`は`pending` → `accepted`。招待・承諾・解除は`/sync/push`を通さない専用CRUD API
  （`calendar_feeds`と同じ扱い。頻度が低く、オフラインで行う必要がないため）
- 権限は「編集権限のみ」（閲覧専用ロールは無い）。共有されたユーザーはそのリスト内のタスクを
  ownerと同じように作成・編集・完了・削除できるが、**リスト自体の名前/色/削除、フォルダ、
  タグの新規作成、Hatchトリガーはownerのみ**（このリリースのスコープ外）

### 複製の仕組み：`shared_row_changes`

```sql
CREATE TABLE shared_row_changes (
  id          TEXT    NOT NULL PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 通知先(editor)
  table_name  TEXT    NOT NULL,  -- 'tasks' | 'lists'
  row_id      TEXT    NOT NULL,
  seq         INTEGER NOT NULL,  -- user_id(editor)自身のsync_state系列のseq
  created_at  INTEGER NOT NULL
);
```

- `tasks`・`lists`の行が変化するたびに、そのリストを共有されている**各editor**について
  `bumpSeq(db, editorUserId)`でeditor自身のseqを進め、`shared_row_changes`に
  `(editorUserId, table_name, row_id, editorSeq)`を1行追記する
  - 誰が変更したか（owner自身かeditorか）に関わらず、変更後の`tasks`/`lists`行は
    常にownerの`user_id`のまま保存される（LWW・所有権チェックの一貫性を保つため）。
    `shared_row_changes`はあくまで「このeditorにも見せる」というポインタでしかない
  - 招待が`accepted`になった瞬間、その時点でリストに存在する全タスクについても
    同様に`shared_row_changes`を作成し、招待前からあったタスクも見えるようにする
- pull時、`tasks`と`lists`だけは「自分がownerの行」と「`shared_row_changes`経由で
  複製された行」をUNIONしてseq昇順にマージする。返す行の`seq`フィールドは
  `shared_row_changes.seq`（＝editor自身の視点のseq）に差し替える。
  同じ行が複数回複製されて重複して返っても、クライアントは冪等にUPSERTするだけなので実害はない
- **書き込みの所有権チェック**：対象行の`user_id`（owner）がリクエストしたユーザーと一致しない場合、
  `list_shares`に`(list_id, owner_user_id, invited_user_id=リクエストユーザー, status='accepted')`
  があるかを確認し、あれば許可する
- **新規タスク作成時のuser_id**：`list_id`のownerを`lists.user_id`から引き、
  リクエストユーザーが本人でなければ共有チェックを通した上で、新規行の`user_id`（＝seq採番先）を
  そのownerにする
- **リスト間移動の禁止**：`update_task`で`list_id`を変更する場合、移動先リストのownerが
  現在のタスクのownerと一致しない場合はreject（別ownerのリストへタスクが越境するのを防ぐ）
- タグ・添付ファイル・Hatchトリガーは共有タスクに対しても**このリリースでは対象外**
  （`task_tags`等への書き込みはowner本人のみ許可のまま）

### GC

- `shared_row_changes`は`applied_ops`と同じ日数（`TOMBSTONE_RETENTION_DAYS`）で物理削除する。
  削除前に`user_id`ごとの`MAX(seq)`を`sync_state.gc_boundary_seq`に記録し、
  それより古い`since`でpullしてきたeditorには`full_resync_required`を返す（6章と同じ仕組み）

### SSE

- owner側の変更で共有先editorのseqも進むため、`broadcastBump`は変更を行ったuser_idだけでなく、
  影響を受けた各editorのuser_idにも`bump`イベントを送る

### フォルダ共有（改修22回目フォローアップ）

リスト共有と対称の、フォルダ単位の共有。**「後からそのフォルダに追加/移動されたリストも
自動的に共有対象になる」動的共有**である点がリスト共有と異なる（ユーザー要望により意図的にこう設計した）。

- `folder_shares(id, folder_id, owner_user_id, invited_user_id, invited_email, status, created_at, accepted_at, deleted_at)`。
  招待・承諾・解除のAPI形状・権限モデル（編集権限のみ）はlist_sharesと完全に対称
- `shared_row_changes.table_name`に`'folders'`を追加（CHECK制約をテーブル再作成で緩和）。
  `folders`もpull時にown+shared複製をUNIONする対象（`tasks`・`lists`と同じ扱い）
- **リストの編集可否判定の拡張**：`resolveEditableListOwner`は、
  「リストを直接list_sharesで共有されている」に加えて
  「リストの所属フォルダ（`lists.folder_id`）がfolder_sharesで共有されている」場合も許可する。
  これによりtasks/listsの共有先editor集合（`listShareEditorIds`）も自動的に
  フォルダ経由の共有先を含むようになり、`apply.ts`・`pull.ts`側のコードは
  リスト共有と共通のまま変更不要で済む
- **動的共有の実現**：
  - 新規リストが最初から共有中フォルダのfolder_idを持って作られた場合、
    そのリスト自体のupsert成功時に（listShareEditorIds経由で）自動的に複製される
  - 既存リストが共有中フォルダへ移動（folder_idが変わる）した場合、そのリストの
    既存タスク全件を新しい共有先へ複製し直す（`replicateAllTasksInList`）。
    逆に共有中フォルダから外れた場合、以後の新しい変更は複製されなくなるが、
    既に複製済みの過去データがeditor側に残る点はリスト間移動と同じ簡略化として許容する
  - フォルダ共有の承諾時は、そのフォルダ自体・配下の全リスト・各リストの全タスクを
    一括で新しいeditorへ複製する（`replicateExistingFolderToNewEditor`）
- **フォルダ自体の書き込みはownerのみ**（リスト共有と同じ方針）。フォルダ名の変更等は
  editorには許可しない。フォルダ自体の複製は「editorが名前を見られるようにする」ためだけの、
  読み取り専用の反映

## 11. テストで必ず確認すること

- [ ] 機内モードで作成 → 復帰 → 別デバイスに反映される
- [ ] 同じ op を 2 回 push しても行が重複しない
- [ ] 2 デバイスで別フィールドを同時編集 → 両方残る
- [ ] 2 デバイスで同じフィールドを同時編集 → 決定的に片方に収束する
- [ ] デバイス A で「X を Y の下へ」、B で「Y を X の下へ」 → 片方が reject され循環しない
- [ ] 完了済み親に未完了の子が同期されてきた → 親が未完了に戻る
- [ ] 31 日オフラインだった端末 → `full_resync_required` で復帰し、未送信分が失われない
