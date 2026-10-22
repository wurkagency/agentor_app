/**
 * Status vocabulary (produktspecifikation §7.1, designspecifikation §5.1).
 * Computed per route and rolled up to flow and dashboard: worst wins.
 */
export const STATUSES = ['broken', 'error', 'warn', 'ok', 'info', 'paused', 'draft'] as const;
export type Status = (typeof STATUSES)[number];

/** Higher = more severe. Afbrudt > Fejl > Advarsel > Aktiv > Test > Pauset > Kladde. */
export const STATUS_SEVERITY: Readonly<Record<Status, number>> = {
  broken: 7,
  error: 6,
  warn: 5,
  ok: 4,
  info: 3,
  paused: 2,
  draft: 1,
};

export function worseStatus(a: Status, b: Status): Status {
  return STATUS_SEVERITY[b] > STATUS_SEVERITY[a] ? b : a;
}

/**
 * Rolls a set of route (or flow) statuses up to one status. An empty set is a flow that has
 * never been given a route: Kladde.
 */
export function rollUpStatus(statuses: Iterable<Status>): Status {
  let result: Status | undefined;
  for (const s of statuses) result = result === undefined ? s : worseStatus(result, s);
  return result ?? 'draft';
}

/** Statuses that need the customer to act; Pauset is deliberately not one of them. */
export function needsAction(status: Status): boolean {
  return status === 'broken' || status === 'error' || status === 'warn';
}
