/**
 * Drains the notification e-mail queue once, as the worker does every 5 seconds (E19–E22), and
 * prints how many e-mails went out. Used by the e2e tests and by hand when checking delivery:
 *   pnpm --filter @agentor/worker exec tsx --env-file=../../.env.local scripts/email-once.ts
 */
import { createDatabase } from '@agentor/db';
import { createMailer } from '@agentor/email';
import { redisConnection } from '@agentor/jobs';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { drainEmailQueue } from '../src/email.js';

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const appUrl = need('APP_URL');
const database = createDatabase(need('DATABASE_URL_WORKER'), { max: 2 });
const redis = redisConnection(need('REDIS_URL'));
const log = pino({ level: 'warn' });
try {
  const sent = await drainEmailQueue({
    db: database.db,
    redis,
    log,
    appUrl,
    send: createMailer({
      transport: nodemailer.createTransport(process.env.SMTP_URL ?? 'smtp://127.0.0.1:51025'),
      from: process.env.MAIL_FROM ?? 'Agentor <no-reply@agentor.dk>',
      appUrl,
      log,
    }),
  });
  console.log(JSON.stringify({ sent }));
} finally {
  await database.close();
  redis.disconnect();
}
