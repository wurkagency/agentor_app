import { isUuid } from '@agentor/db';
import { Responsive } from '@agentor/ui/mobile';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { requireAppContext } from '@/server/auth/session';
import { viewsFor } from '@/server/flows';
import { RunsMobile, runsRange } from './mobile';

export async function generateMetadata() {
  const t = await getTranslations('mobile.runs');
  return { title: t('title') };
}

/** MA24 Kørsler for one flow. On a computer the flow page's Kørsler tab (D8) shows the same. */
export default async function FlowRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const ctx = await requireAppContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const f = (await viewsFor(ctx)).find((v) => v.id === id);
  if (!f) notFound();
  const t = await getTranslations('mobile.runs');
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  return (
    <Responsive
      desktop={<DesktopRedirect href={`/integrations/${id}?tab=runs`} label={t('title')} />}
      mobile={
        <RunsMobile
          f={f}
          ctx={{ tenantId: ctx.tenant.tenantId, userId: ctx.user.id }}
          range={runsRange((await searchParams).range)}
          canEdit={canEdit}
        />
      }
    />
  );
}
