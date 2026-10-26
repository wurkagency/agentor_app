// Client-safe: shared by the filter bar (browser) and the page/export (server). No server imports.
export const ACTION_GROUPS = [
  'member',
  'invitation',
  'company',
  'security',
  'support',
  'notifications',
  'connection',
  'subscription',
  'flow',
] as const;
export const PERIODS = { '7': 7, '30': 30, '90': 90 } as const;

export interface AuditQuery {
  user?: string | undefined;
  group?: string | undefined;
  period?: string | undefined;
  support?: string | undefined;
  before?: string | undefined;
}
