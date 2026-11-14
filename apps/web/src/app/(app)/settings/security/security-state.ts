// Client-safe: the security page's props and a support grant's state, for the mobile view (MA31).

export interface GrantVM {
  id: string;
  caseRef: string;
  supportName: string;
  reason: string;
  scope: 'view' | 'help';
  hours: number;
  endedAt: string | null;
  requestedAt: string;
  approvedAt: string | null;
  deniedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}

export interface SecurityProps {
  isAdmin: boolean;
  mfaEnabled: boolean;
  requireMfaAll: boolean;
  missingMfa: string[];
  supportRequiresApproval: boolean;
  grants: GrantVM[];
  sessions: {
    id: string;
    device: string;
    ip: string | null;
    lastActive: string;
    current: boolean;
  }[];
}

/** Same order of precedence as the desktop list (D12-Sikkerhed). */
export function decideSupportState(
  g: GrantVM,
  now = Date.now(),
): 'revoked' | 'denied' | 'expired' | 'active' | 'pending' {
  if (g.revokedAt || g.endedAt) return 'revoked';
  if (g.deniedAt) return 'denied';
  if (new Date(g.expiresAt).getTime() <= now) return 'expired';
  return g.approvedAt ? 'active' : 'pending';
}
