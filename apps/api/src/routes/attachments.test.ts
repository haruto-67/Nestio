import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { issueUploadToken } from '../attachments/upload-tokens.js';
import { issueDownloadToken } from '../attachments/download-tokens.js';

function setupApp(db: Database.Database, attachmentDir: string) {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    ATTACHMENT_DIR: attachmentDir,
    ATTACHMENT_MAX_BYTES: '1000000',
    ATTACHMENT_QUOTA_BYTES: '2000000',
  } as unknown as NodeJS.ProcessEnv);
  const logger = createLogger(env);
  return createApp(env, db, logger);
}

function insertSession(db: Database.Database, userId: string): string {
  const sessionId = 'test-session-' + uuidv7();
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(sessionId, userId, Date.now() + 100_000, Date.now());
  return sessionId;
}

function insertAttachmentRow(db: Database.Database, userId: string, sha256: string, bytes: number): void {
  db.prepare(
    `INSERT INTO attachments (id, user_id, owner_type, owner_id, sha256, filename, mime, bytes, width, height, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, 'note', ?, ?, 'test.png', 'image/png', ?, NULL, NULL, ?, ?, NULL, 1)`,
  ).run(uuidv7(), userId, uuidv7(), sha256, bytes, Date.now(), Date.now());
}

function saveFileDirectly(dir: string, sha256: string, data: Buffer): void {
  const subDir = path.join(dir, sha256.slice(0, 2));
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, sha256), data);
}

// PNGシグネチャ + ダミーバイト。マジックバイト検証だけ通ればよく、有効なPNGとしてデコードできる必要はない
const FAKE_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([1, 2, 3, 4])]);

describe('attachments route', () => {
  let db: Database.Database;
  let attachmentDir: string;

  beforeEach(() => {
    attachmentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-attach-test-'));
  });

  afterEach(() => {
    db?.close();
    fs.rmSync(attachmentDir, { recursive: true, force: true });
  });

  it('画像をアップロードし、メタデータ登録後に取得できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');

    const postRes = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}` },
      body: FAKE_PNG,
    });
    expect(postRes.status).toBe(201);

    insertAttachmentRow(db, userId, sha256, FAKE_PNG.length);

    const getRes = await app.request(`/api/v1/attachments/${sha256}`, {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const body = Buffer.from(await getRes.arrayBuffer());
    expect(body.equals(FAKE_PNG)).toBe(true);
  });

  it('既に存在するファイルへの再アップロードは200で即返る', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    saveFileDirectly(attachmentDir, sha256, FAKE_PNG);

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}` },
      body: Buffer.from('this body is ignored because file already exists'),
    });
    expect(res.status).toBe(200);
  });

  it('SHA-256がURLと一致しないと400', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db, attachmentDir);

    const wrongSha256 = 'a'.repeat(64);
    const res = await app.request(`/api/v1/attachments/${wrongSha256}`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}` },
      body: FAKE_PNG,
    });
    expect(res.status).toBe(400);
  });

  it('画像でないデータは400', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db, attachmentDir);

    const notImage = Buffer.from('not an image, just a plain text payload');
    const sha256 = crypto.createHash('sha256').update(notImage).digest('hex');

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}` },
      body: notImage,
    });
    expect(res.status).toBe(400);
  });

  it('レコードを持たないユーザーは他人の添付をGETできない', async () => {
    db = createTestDb();
    const ownerId = uuidv7();
    insertTestUser(db, ownerId);
    const otherId = uuidv7();
    insertTestUser(db, otherId);
    const otherSessionId = insertSession(db, otherId);
    const app = setupApp(db, attachmentDir);

    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    saveFileDirectly(attachmentDir, sha256, FAKE_PNG);
    insertAttachmentRow(db, ownerId, sha256, FAKE_PNG.length);

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      headers: { Cookie: `nestio_session=${otherSessionId}` },
    });
    expect(res.status).toBe(404);
  });

  it('ATTACHMENT_ENCRYPTION_KEY設定時はディスク上で暗号化され、GETでは元の画像がそのまま返る（改修5回目）', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const encryptionKey = crypto.randomBytes(32).toString('base64');
    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      ATTACHMENT_DIR: attachmentDir,
      ATTACHMENT_MAX_BYTES: '1000000',
      ATTACHMENT_QUOTA_BYTES: '2000000',
      ATTACHMENT_ENCRYPTION_KEY: encryptionKey,
    } as unknown as NodeJS.ProcessEnv);
    const app = createApp(env, db, createLogger(env));
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');

    const postRes = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}` },
      body: FAKE_PNG,
    });
    expect(postRes.status).toBe(201);

    // ディスク上のファイルは平文のPNGバイト列と一致しない（暗号化されている）
    const rawOnDisk = fs.readFileSync(path.join(attachmentDir, sha256.slice(0, 2), sha256));
    expect(rawOnDisk.equals(FAKE_PNG)).toBe(false);

    insertAttachmentRow(db, userId, sha256, FAKE_PNG.length);

    const getRes = await app.request(`/api/v1/attachments/${sha256}`, {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(getRes.status).toBe(200);
    const body = Buffer.from(await getRes.arrayBuffer());
    expect(body.equals(FAKE_PNG)).toBe(true);
  });

  // 改修19回目：MCPからの読み出しでget_attachmentのbase64サイズ上限（1MB）に阻まれる添付を
  // curlで直接GETできるようにする、書き込み側と対称なワンタイムダウンロードトークン
  it('ダウンロードトークンでGETすると画像が返る', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    saveFileDirectly(attachmentDir, sha256, FAKE_PNG);
    insertAttachmentRow(db, userId, sha256, FAKE_PNG.length);
    const { token } = issueDownloadToken(db, userId, sha256);

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(FAKE_PNG)).toBe(true);
  });

  it('ダウンロードトークンは1回使うと2回目は401になる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    saveFileDirectly(attachmentDir, sha256, FAKE_PNG);
    insertAttachmentRow(db, userId, sha256, FAKE_PNG.length);
    const { token } = issueDownloadToken(db, userId, sha256);

    const firstRes = await app.request(`/api/v1/attachments/${sha256}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(firstRes.status).toBe(200);

    const secondRes = await app.request(`/api/v1/attachments/${sha256}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(secondRes.status).toBe(401);
  });

  it('他人のダウンロードトークンでは他人の添付をGETできない', async () => {
    db = createTestDb();
    const ownerId = uuidv7();
    insertTestUser(db, ownerId);
    const otherId = uuidv7();
    insertTestUser(db, otherId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    saveFileDirectly(attachmentDir, sha256, FAKE_PNG);
    insertAttachmentRow(db, ownerId, sha256, FAKE_PNG.length);
    const { token } = issueDownloadToken(db, otherId, sha256);

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('無効なダウンロードトークンは401', async () => {
    db = createTestDb();
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });

  it('未認証は401', async () => {
    db = createTestDb();
    const app = setupApp(db, attachmentDir);
    const res = await app.request(`/api/v1/attachments/${'a'.repeat(64)}`);
    expect(res.status).toBe(401);
  });

  // 改修17回目：MCPのアクセストークンはコンテナ内のClaudeに渡らないため、create_attachment_upload
  // が発行するワンタイムトークンでこのPOSTエンドポイントを直接叩けるようにした
  it('アップロードトークンでPOSTすると201になり、attachmentレコードも自動作成される', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    const ownerId = uuidv7();
    const { token } = issueUploadToken(db, userId, 'task', ownerId, 'photo.png', sha256);

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: FAKE_PNG,
    });
    expect(res.status).toBe(201);

    const row = db
      .prepare('SELECT owner_type, owner_id, filename, mime, bytes FROM attachments WHERE sha256 = ? AND user_id = ?')
      .get(sha256, userId) as { owner_type: string; owner_id: string; filename: string; mime: string; bytes: number };
    expect(row).toMatchObject({
      owner_type: 'task',
      owner_id: ownerId,
      filename: 'photo.png',
      mime: 'image/png',
      bytes: FAKE_PNG.length,
    });
  });

  it('アップロードトークンは1回使うと2回目は401になる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    const ownerId = uuidv7();
    const { token } = issueUploadToken(db, userId, 'task', ownerId, 'photo.png', sha256);

    const firstRes = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: FAKE_PNG,
    });
    expect(firstRes.status).toBe(201);

    const secondRes = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: FAKE_PNG,
    });
    expect(secondRes.status).toBe(401);
  });

  // 改修17回目フォローアップ3：実機検証（2026-08-22）で、宣言と異なるバイト列をPOSTして
  // 400になった直後、正しいファイルを同じトークンで送っても401（リトライ不可）になる
  // ことが判明した。確定消費のタイミングをバイト列検証の後に移し、これを解消した
  it('sha256不一致で400になっても、同じトークンで正しいファイルを再送すれば201で成功する', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    const ownerId = uuidv7();
    const { token } = issueUploadToken(db, userId, 'task', ownerId, 'photo.png', sha256);

    const wrongBody = Buffer.concat([FAKE_PNG, Buffer.from('extra bytes')]);
    const failRes = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: wrongBody,
    });
    expect(failRes.status).toBe(400);

    const retryRes = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: FAKE_PNG,
    });
    expect(retryRes.status).toBe(201);
  });

  // 改修19回目：attempts_exceededは「認証が通っていない」のではなく「使い切った」ことを
  // コードだけで区別できるよう、401ではなく429（rate_limited）にした
  it('検証失敗を繰り返し再試行回数の上限（3回）を超えると429になる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    const ownerId = uuidv7();
    const { token } = issueUploadToken(db, userId, 'task', ownerId, 'photo.png', sha256);

    const wrongBody = Buffer.concat([FAKE_PNG, Buffer.from('extra bytes')]);
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/api/v1/attachments/${sha256}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: wrongBody,
      });
      expect(res.status).toBe(400);
    }

    const finalRes = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: FAKE_PNG,
    });
    expect(finalRes.status).toBe(429);
  });

  it('400レスポンスにattempts_remainingが含まれ、試行のたびに減っていく', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    const ownerId = uuidv7();
    const { token } = issueUploadToken(db, userId, 'task', ownerId, 'photo.png', sha256);

    const wrongBody = Buffer.concat([FAKE_PNG, Buffer.from('extra bytes')]);
    const firstRes = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: wrongBody,
    });
    expect(firstRes.status).toBe(400);
    const firstBody = (await firstRes.json()) as { error: { details?: { attempts_remaining?: number } } };
    expect(firstBody.error.details?.attempts_remaining).toBe(2);

    const secondRes = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: wrongBody,
    });
    const secondBody = (await secondRes.json()) as { error: { details?: { attempts_remaining?: number } } };
    expect(secondBody.error.details?.attempts_remaining).toBe(1);
  });

  it('無効なアップロードトークンは401', async () => {
    db = createTestDb();
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-real-token' },
      body: FAKE_PNG,
    });
    expect(res.status).toBe(401);
  });

  it('アップロードトークン発行時のsha256とURLのsha256が異なると400', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    const { token } = issueUploadToken(db, userId, 'task', uuidv7(), 'photo.png', 'f'.repeat(64));

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: FAKE_PNG,
    });
    expect(res.status).toBe(400);
  });

  it('アップロードトークン経由で既存ファイルへPOSTしても、レコードが無ければ作成される', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(db, attachmentDir);
    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    saveFileDirectly(attachmentDir, sha256, FAKE_PNG); // 実体だけ既に存在する状態を再現
    const ownerId = uuidv7();
    const { token } = issueUploadToken(db, userId, 'note', ownerId, 'dup.png', sha256);

    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: Buffer.from('ignored because file already exists'),
    });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT owner_type, owner_id FROM attachments WHERE sha256 = ? AND user_id = ?').get(sha256, userId);
    expect(row).toMatchObject({ owner_type: 'note', owner_id: ownerId });
  });

  it('容量上限超過は413', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      ATTACHMENT_DIR: attachmentDir,
      ATTACHMENT_MAX_BYTES: '1000000',
      ATTACHMENT_QUOTA_BYTES: '10',
    } as unknown as NodeJS.ProcessEnv);
    const app = createApp(env, db, createLogger(env));

    const sha256 = crypto.createHash('sha256').update(FAKE_PNG).digest('hex');
    const res = await app.request(`/api/v1/attachments/${sha256}`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}` },
      body: FAKE_PNG,
    });
    expect(res.status).toBe(413);
  });
});
