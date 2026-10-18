import {
  listFlowOptions,
  listMembers,
  listOpenInvitations,
  getSecuritySettings,
} from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/shell/secondary-nav';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { TeamView } from './team-view';

export async function generateMetadata() {
  const t = await getTranslations('team');
  return { title: t('title') };
}

/** Team og adgang (D11-Team, D11-Inviter). */
export default async function TeamPage() {
  const ctx = await requireRole(['owner', 'admin']);
  const c = { tenantId: ctx.tenant.tenantId, userId: ctx.user.id };
  const [members, invitations, flows, security] = await Promise.all([
    listMembers(db(), c),
    listOpenInvitations(db(), c),
    listFlowOptions(db(), c),
    getSecuritySettings(db(), c),
  ]);
  return (
    <PageBody>
      <TeamView
        me={{ userId: ctx.user.id, role: ctx.tenant.role }}
        companyName={ctx.tenant.tenantName}
        members={members.map((m) => ({
          ...m,
          lastActiveAt: m.lastActiveAt?.toISOString() ?? null,
          grants: m.grants.map((g) => ({ ...g, expiresAt: g.expiresAt?.toISOString() ?? null })),
        }))}
        invitations={invitations.map((i) => ({
          ...i,
          expiresAt: i.expiresAt.toISOString(),
          createdAt: i.createdAt.toISOString(),
        }))}
        flows={flows}
        seats={null}
        supportRequiresApproval={security.supportRequiresApproval}
      />
    </PageBody>
  );
}
