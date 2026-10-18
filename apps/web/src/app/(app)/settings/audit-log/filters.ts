import { isUuid, type AuditFilter } from '@agentor/db';
import { ACTION_GROUPS, PERIODS, type AuditQuery } from './query';

export { ACTION_GROUPS, type AuditQuery };

/** URL search params → repository filter. Unknown values are ignored, never passed through. */
export function toFilter(q: AuditQuery, limit = 50): AuditFilter {
  const days = PERIODS[(q.period ?? '30') as keyof typeof PERIODS] ?? 30;
  const before = q.before && !Number.isNaN(Date.parse(q.before)) ? new Date(q.before) : undefined;
  return {
    actorUserId: q.user && isUuid(q.user) ? q.user : undefined,
    actionPrefix: ACTION_GROUPS.includes(q.group as (typeof ACTION_GROUPS)[number])
      ? `${q.group}.`
      : undefined,
    since: new Date(Date.now() - days * 24 * 3600 * 1000),
    supportOnly: q.support === '1',
    before,
    limit,
  };
}

/** Short description of the object a log entry refers to, from the stored before/after. */
export function describeObject(entry: {
  objectType: string;
  before: unknown;
  after: unknown;
}): string {
  const v = (entry.after ?? entry.before ?? {}) as Record<string, unknown>;
  const parts = [v.email, v.caseRef, v.name, v.reason].filter(
    (x): x is string => typeof x === 'string' && x !== '',
  );
  return parts.length ? parts.join(' · ') : entry.objectType;
}
