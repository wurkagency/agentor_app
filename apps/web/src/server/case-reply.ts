import { randomBytes } from 'node:crypto';
import { ensureCaseReplyToken } from '@agentor/db';
import { env } from './env';
import { db } from './infra';

/**
 * Reply-To for E12 (PLAN-EMAILS-PDF Q4): the case's own address, sag+<token>@CASE_REPLY_DOMAIN.
 * A reply to it reaches agentor-ingest (Brevo Inbound Parsing) and is added to the case, which
 * reopens it within 14 days. Without the domain, replies go to support as before.
 */
export async function caseReplyAddress(staffUserId: string, caseId: string): Promise<string> {
  const domain = env().CASE_REPLY_DOMAIN;
  if (!domain) return 'support@agentor.dk';
  const token = await ensureCaseReplyToken(
    db(),
    staffUserId,
    caseId,
    randomBytes(16).toString('hex'),
  );
  return `sag+${token}@${domain}`;
}
