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

  it('未認証は401', async () => {
    db = createTestDb();
    const app = setupApp(db, attachmentDir);
    const res = await app.request(`/api/v1/attachments/${'a'.repeat(64)}`);
    expect(res.status).toBe(401);
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
