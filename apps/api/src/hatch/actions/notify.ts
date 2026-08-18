import type Database from 'better-sqlite3';
import type { Env } from '../../env.js';
import type { Logger } from '../../logger.js';
import { sendPushToUser } from '../../push/sender.js';
import { expandTemplate } from '../template.js';

/** "key1:url1,key2:url2" 形式（docs/manual-setup.md D-1）をパースする */
export function parseKeyedEnvList(envValue: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of envValue.split(',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}

export async function runPushNotify(
  db: Database.Database,
  env: Env,
  logger: Logger,
  userId: string,
  params: { title: string; body: string },
): Promise<void> {
  await sendPushToUser(db, env, logger, userId, { title: params.title, body: params.body });
}

export async function runDiscordNotify(
  db: Database.Database,
  env: Env,
  subjectTaskId: string | null,
  params: { webhook_key: string; message_template: string },
  userId?: string,
): Promise<void> {
  const webhooks = parseKeyedEnvList(env.DISCORD_WEBHOOKS);
  const url = webhooks[params.webhook_key];
  if (!url) throw new Error(`discord webhook not registered: ${params.webhook_key}`);

  const message = await expandTemplate(db, params.message_template, subjectTaskId, userId);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
  });
  if (!res.ok) throw new Error(`discord webhook failed: ${res.status}`);
}
