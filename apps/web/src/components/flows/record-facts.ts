import { formatDate, formatTime, type Locale } from '@agentor/i18n';

/** The fields of a run record the Developer view lists (D8, MA25). */
export interface RecordFactsInput {
  id: string;
  runId: string;
  routeId: string;
  entity: string;
  sourceId: string;
  sourceVersion?: string | null;
  destinationId?: string | null;
  outcome: string;
  errorCode?: string | null;
  errorParams?: unknown;
  attempts?: number | null;
  durationMs?: number | null;
  createdAt: Date;
  resolvedAt?: Date | null;
}

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * Key-value facts for the Developer view: ids, route, attempts, timing and the error's parameters.
 * Only what the record holds; empty fields are left out.
 */
export function recordFacts(
  r: RecordFactsInput,
  t: T,
  locale: Locale,
  routeLabel: string | undefined,
): { k: string; v: string; mono?: boolean }[] {
  const when = (d: Date) => `${formatDate(d, locale)} ${formatTime(d, locale)}`;
  const params =
    r.errorParams && typeof r.errorParams === 'object' && Object.keys(r.errorParams).length
      ? JSON.stringify(r.errorParams)
      : null;
  const facts: { k: string; v: string | null | undefined; mono?: boolean }[] = [
    { k: t('facts.recordId'), v: r.id, mono: true },
    { k: t('facts.runId'), v: r.runId, mono: true },
    { k: t('facts.route'), v: routeLabel ? `${routeLabel} (${r.routeId})` : r.routeId },
    { k: t('facts.entity'), v: r.entity },
    { k: t('facts.sourceId'), v: r.sourceId, mono: true },
    { k: t('facts.sourceVersion'), v: r.sourceVersion, mono: true },
    { k: t('facts.destinationId'), v: r.destinationId, mono: true },
    { k: t('facts.outcome'), v: r.outcome, mono: true },
    { k: t('facts.errorCode'), v: r.errorCode, mono: true },
    { k: t('facts.errorParams'), v: params, mono: true },
    { k: t('facts.attempts'), v: r.attempts ? String(r.attempts) : null },
    {
      k: t('facts.duration'),
      v: r.durationMs !== null && r.durationMs !== undefined ? `${r.durationMs} ms` : null,
    },
    { k: t('facts.createdAt'), v: when(r.createdAt) },
    { k: t('facts.resolvedAt'), v: r.resolvedAt ? when(r.resolvedAt) : null },
  ];
  return facts.filter((f): f is { k: string; v: string; mono?: boolean } => Boolean(f.v));
}
