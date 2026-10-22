import { manifestFor } from '@agentor/connectors';
import { Card, CardHeader, cn, Icon } from '@agentor/ui';
import { Check, Info, Workflow } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/button-link';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import type { AppContext } from '@/server/auth/session';
import type { ConnectionRef } from '@/server/flows';

/**
 * D1-Ny-kunde: the "Kom i gang" checklist until the first flow is published. It follows the
 * activation metric "første testkørsel gennemført" (produktspecifikation §7.9).
 */
export async function NewCustomer({
  ctx,
  firstName,
  company,
  planName,
  connections,
  hasFlows,
  firstFlowId,
}: {
  ctx: AppContext;
  firstName: string;
  company: { name: string; cvr: string | null; firstTestRunAt: Date | null } | null;
  planName: string;
  connections: ConnectionRef[];
  hasFlows: boolean;
  firstFlowId: string | null;
}) {
  const t = await getTranslations('overview.newCustomer');
  const ok = connections.filter((c) => c.status === 'ok');
  const shop = ok.find((c) => manifestFor(c.connectorId)?.category === 'webshop');
  const erp = ok.find((c) => manifestFor(c.connectorId)?.category === 'erp');
  const steps = [
    {
      key: 'company',
      done: true,
      title: t('company'),
      body: [company?.name, company?.cvr ? `CVR ${company.cvr}` : null].filter(Boolean).join(' · '),
      action: null,
    },
    {
      key: 'shop',
      done: Boolean(shop),
      title: t('shop'),
      body: shop ? `${manifestFor(shop.connectorId)?.name} · ${shop.name}` : t('shopBody'),
      action: { label: t('shopAction'), href: '/connections/new' },
    },
    {
      key: 'erp',
      done: Boolean(erp),
      title: t('erp'),
      body: erp ? `${manifestFor(erp.connectorId)?.name} · ${erp.name}` : t('erpBody'),
      action: { label: t('erpAction'), href: '/connect/dinero' },
    },
    {
      key: 'flow',
      done: hasFlows,
      title: t('flow'),
      body: t('flowBody'),
      action: { label: t('flowAction'), href: '/integrations/new?template=webshop-dinero' },
    },
    {
      key: 'live',
      done: Boolean(company?.firstTestRunAt),
      title: t('live'),
      body: t('liveBody'),
      action: firstFlowId
        ? { label: t('liveAction'), href: `/integrations/${firstFlowId}/editor` }
        : null,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);
  const canEdit = ['owner', 'admin', 'developer'].includes(ctx.tenant.role);
  return (
    <PageBody>
      <PageHeader
        title={t('title', { name: firstName })}
        subtitle={t('subtitle', {
          company: ctx.tenant.tenantName,
          plan: planName,
          count: steps.length - done,
        })}
      />
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="flex flex-col gap-4 lg:col-span-7" aria-labelledby="getting-started">
          <div className="flex items-baseline justify-between">
            <h2 id="getting-started" className="m-0 text-card">
              {t('heading')}
            </h2>
            <span className="text-table font-semibold">
              {t('progress', { done, total: steps.length })}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1" aria-hidden>
            {steps.map((s) => (
              <span
                key={s.key}
                className={cn('h-1.5 rounded-full', s.done ? 'bg-primary' : 'bg-bg-base')}
              />
            ))}
          </div>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {steps.map((s, i) => (
              <li
                key={s.key}
                className={cn(
                  'flex items-center gap-4 rounded-sm px-4 py-3',
                  i === current && 'bg-bg-base',
                )}
                aria-current={i === current ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'grid size-7 flex-none place-items-center rounded-full text-meta font-semibold box-border',
                    s.done
                      ? 'bg-fg-1 text-primary'
                      : i === current
                        ? 'border border-fg-1 bg-primary'
                        : 'border border-border text-fg-2',
                  )}
                >
                  {s.done ? <Icon icon={Check} size={14} /> : i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn('text-body', s.done ? 'text-fg-2 line-through' : 'font-semibold')}
                  >
                    {s.title}
                    {s.done && <span className="sr-only"> ({t('done')})</span>}
                  </span>
                  <span className="text-meta text-fg-2">{s.body}</span>
                </div>
                {i === current && s.action && canEdit && (
                  <ButtonLink variant="primary" size="s" href={s.action.href}>
                    {s.action.label}
                  </ButtonLink>
                )}
              </li>
            ))}
          </ol>
        </Card>
        <div className="flex flex-col gap-4 lg:col-span-5">
          <Card className="flex flex-col gap-3">
            <CardHeader title={t('status')} />
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-bg-base">
                <Icon icon={Workflow} size={18} />
              </span>
              <div className="flex flex-col">
                <span className="text-body font-semibold">{t('noFlows')}</span>
                <span className="text-meta text-fg-2">{t('noFlowsBody')}</span>
              </div>
            </div>
          </Card>
          <Card className="flex flex-col gap-3">
            <CardHeader title={t('numbers')} />
            <div className="grid grid-cols-2 gap-3">
              {['revenue', 'orders', 'records', 'errorRate'].map((k) => (
                <div key={k} className="flex flex-col gap-2 rounded-sm bg-bg-base p-3">
                  <span className="text-meta text-fg-2">{t(`kpi.${k}`)}</span>
                  <span className="text-stat-compact font-semibold">–</span>
                </div>
              ))}
            </div>
            <p className="m-0 text-meta text-fg-2">{t('numbersLater')}</p>
          </Card>
          <Card className="flex gap-3">
            <Icon icon={Info} size={16} className="mt-1 text-info-fg" />
            <div className="flex flex-col gap-2">
              <span className="text-body font-semibold">{t('help')}</span>
              <span className="text-table text-fg-2">{t('helpBody')}</span>
              <div className="flex gap-2">
                <ButtonLink variant="secondary" size="s" href="/support/new">
                  {t('contactSupport')}
                </ButtonLink>
                {['owner', 'admin'].includes(ctx.tenant.role) && (
                  <ButtonLink variant="secondary" size="s" href="/settings/team">
                    {t('invite')}
                  </ButtonLink>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </PageBody>
  );
}
