import { manifestFor } from '@agentor/connectors';
import { isUuid } from '@agentor/db';
import { Banner, ConnectorLogo } from '@agentor/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { FocusCard } from '@/components/focus-card';
import { requireRole } from '@/server/auth/session';
import { env } from '@/server/env';
import { ConsentForm } from './consent-form';

export async function generateMetadata() {
  const t = await getTranslations('connections');
  return { title: t('consentTitle') };
}

/**
 * Stand-in for the provider's OAuth consent screen while connectors run against mock data
 * (CONNECTOR_MODE=mock, Fase 1). In live mode this route sends the customer to the provider.
 */
export default async function ConnectPage({
  params,
  searchParams,
}: {
  params: Promise<{ connector: string }>;
  searchParams: Promise<{ reconnect?: string }>;
}) {
  await requireRole(['owner', 'admin', 'developer']);
  const { connector } = await params;
  const m = manifestFor(connector);
  if (!m || m.auth.type !== 'oauth2' || env().CONNECTOR_MODE !== 'mock') notFound();
  const { reconnect } = await searchParams;
  const t = await getTranslations('connections');
  return (
    <FocusCard
      icon={<ConnectorLogo connector={{ name: m.name, logoUrl: m.logo }} size={32} />}
      title={t('consentHeading', { name: m.name })}
      intro={t('consentIntro', { name: m.name })}
    >
      <Banner tone="info">{t('consentMock', { name: m.name })}</Banner>
      <ul className="m-0 flex flex-col gap-1 pl-5 text-table">
        {[...m.inputs, ...m.outputs].map((p) => (
          <li key={`${p.entity}-${p.label}`}>{p.label}</li>
        ))}
      </ul>
      <ConsentForm
        connectorId={m.id}
        reconnectId={reconnect && isUuid(reconnect) ? reconnect : null}
        name={m.name}
      />
    </FocusCard>
  );
}
