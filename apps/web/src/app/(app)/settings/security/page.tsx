import { getSecuritySettings, listMembers, listUserSessions, maskIp } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { describeAgent } from '@/server/auth/new-device';
import { requireCustomerArea } from '@/server/auth/session';
import { db } from '@/server/infra';
import { SecurityView } from './security-view';

export async function generateMetadata() {
  const t = await getTranslations('security');
  return { title: t('title') };
}

/** Sikkerhed (D12-Sikkerhed). Location per session needs GeoIP, which v1 doesn't have. */
export default async function SecurityPage() {
  // Everyone manages their own MFA, passkeys and sessions; team-wide settings are for admins.
  const ctx = await requireCustomerArea();
  const isAdmin = ctx.tenant.role === 'owner' || ctx.tenant.role === 'admin';
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [settings, sessions, members] = await Promise.all([
    getSecuritySettings(db(), c),
    listUserSessions(db(), ctx.user.id),
    isAdmin ? listMembers(db(), c) : Promise.resolve([]),
  ]);
  const t = await getTranslations('security');
  const nav = await getTranslations('nav');
  return (
    <PageBody>
      <PageHeader eyebrow={nav('settings')} title={t('title')} subtitle={t('intro')} />
      <SecurityView
        isAdmin={isAdmin}
        mfaEnabled={ctx.user.twoFactorEnabled}
        requireMfaAll={settings.requireMfaAll}
        missingMfa={members.filter((m) => !m.twoFactorEnabled).map((m) => m.name)}
        supportRequiresApproval={settings.supportRequiresApproval}
        grants={settings.grants.map((g) => ({
          id: g.id,
          caseRef: g.caseRef,
          supportName: g.supportName,
          reason: g.reason,
          scope: g.scope,
          hours: g.hours,
          endedAt: g.endedAt?.toISOString() ?? null,
          requestedAt: g.requestedAt.toISOString(),
          approvedAt: g.approvedAt?.toISOString() ?? null,
          deniedAt: g.deniedAt?.toISOString() ?? null,
          revokedAt: g.revokedAt?.toISOString() ?? null,
          expiresAt: g.expiresAt.toISOString(),
        }))}
        sessions={sessions.map((s) => ({
          id: s.id,
          device: s.userAgent ? describeAgent(s.userAgent) : '–',
          ip: maskIp(s.ipAddress),
          lastActive: s.updatedAt.toISOString(),
          current: s.id === ctx.sessionId,
        }))}
      />
    </PageBody>
  );
}
