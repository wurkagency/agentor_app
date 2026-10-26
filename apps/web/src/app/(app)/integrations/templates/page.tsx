import { manifestFor } from '@agentor/connectors';
import { getTranslations } from 'next-intl/server';
import { TemplatePicker } from '@/components/editor/template-picker';
import { TEMPLATES } from '@/components/editor/templates';
import { requireRole } from '@/server/auth/session';
import { connectionMap } from '@/server/flows';

export async function generateMetadata() {
  const t = await getTranslations('templates');
  return { title: t('title') };
}

/** Skabeloner: the same picker, reached from the secondary navigation. */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const ctx = await requireRole(['owner', 'admin', 'developer'], { support: true });
  const conns = [...(await connectionMap(ctx.tenant.tenantId, ctx.user.id)).values()];
  const ready = new Set(conns.filter((c) => c.status !== 'broken').map((c) => c.connectorId));
  const { template } = await searchParams;
  return (
    <TemplatePicker
      initial={TEMPLATES.some((x) => x.id === template) ? template! : 'webshop-dinero'}
      templates={TEMPLATES.map((x) => ({
        ...x,
        missing: [...x.destinations, ...(x.source.some((s) => ready.has(s)) ? [] : [x.source[0]!])]
          .filter((c) => !ready.has(c))
          .map((c) => manifestFor(c)?.name ?? c),
        logos: [x.source.find((s) => ready.has(s)) ?? x.source[0]!, ...x.destinations].map((c) => ({
          id: c,
          name: manifestFor(c)?.name ?? c,
          logo: manifestFor(c)?.logo ?? '',
        })),
      }))}
    />
  );
}
