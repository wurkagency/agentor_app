import { ConnectorLogo, Icon } from '@agentor/ui';
import { ArrowRight, Workflow } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ButtonLink } from '@/components/button-link';

const SUGGESTED = [
  { id: 'webshop-dinero', from: 'woocommerce', to: 'dinero' },
  { id: 'customers-hubspot', from: 'woocommerce', to: 'hubspot' },
  { id: 'customers-brevo', from: 'woocommerce', to: 'brevo' },
] as const;

const NAMES: Record<string, string> = {
  woocommerce: 'WooCommerce',
  dinero: 'Dinero',
  hubspot: 'HubSpot',
  brevo: 'Brevo',
};

/** D2-Tom: no flows yet; templates for the connections that are ready. */
export async function EmptyFlows({
  connected,
  canEdit,
}: {
  connected: string[];
  canEdit: boolean;
}) {
  const t = await getTranslations('flows');
  const to = await getTranslations('templates');
  const names = [...new Set(connected)].map((c) => NAMES[c] ?? c);
  return (
    <section className="flex flex-col items-center gap-6 rounded-md bg-surface px-6 py-12 text-center shadow-sm">
      <span className="grid size-12 place-items-center rounded-full bg-bg-base">
        <Icon icon={Workflow} size={24} />
      </span>
      <div className="flex max-w-xl flex-col gap-2">
        <h2 className="m-0 text-card">{t('emptyTitle')}</h2>
        <p className="m-0 text-fg-2">
          {names.length ? t('emptyBodyConnected', { names: names.join(' og ') }) : t('emptyBody')}
        </p>
      </div>
      {canEdit && (
        <>
          <ul className="m-0 grid w-full max-w-3xl list-none gap-3 p-0 md:grid-cols-3">
            {SUGGESTED.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/integrations/new?template=${s.id}`}
                  className="flex h-full flex-col gap-2 rounded-node p-4 text-left text-fg-1 no-underline shadow-ring-chip hover:bg-bg-base"
                >
                  <span className="flex items-center gap-2" aria-hidden>
                    <ConnectorLogo
                      size={24}
                      connector={{ name: NAMES[s.from]!, logoUrl: `/logos/${s.from}.svg` }}
                    />
                    <Icon icon={ArrowRight} size={14} className="text-fg-2" />
                    <ConnectorLogo
                      size={24}
                      connector={{ name: NAMES[s.to]!, logoUrl: `/logos/${s.to}.svg` }}
                    />
                  </span>
                  <span className="text-body font-semibold">{to(`catalog.${s.id}.title`)}</span>
                  <span className="text-table text-fg-2">{to(`catalog.${s.id}.body`)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <ButtonLink variant="secondary" href="/integrations/templates">
              {t('allTemplates')}
            </ButtonLink>
            <ButtonLink variant="ghost" href="/integrations/new">
              {t('startBlank')}
            </ButtonLink>
          </div>
        </>
      )}
    </section>
  );
}
