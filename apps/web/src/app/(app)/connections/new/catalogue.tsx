'use client';

import type { AuthField, Category } from '@agentor/connectors';
import {
  Banner,
  Button,
  ConnectorLogo,
  CopyButton,
  Dialog,
  Field,
  FilterChip,
  Input,
  StatusPill,
} from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { connectWithKey } from '../actions';

export interface CatalogueItem {
  id: string;
  name: string;
  subtitle: string;
  category: Category;
  logo: string | null;
  available: boolean;
  connected: boolean;
  auth:
    | {
        type: 'key';
        fields: AuthField[];
        webhook: boolean;
        /**
         * Live mode: the shop's own key flow is offered first (WooCommerce /wc-auth), and the
         * webhooks are registered by Agentor, so no address to paste.
         */
        live?: { keyFlow: boolean; autoWebhook: boolean };
      }
    | { type: 'oauth'; provider: string; scopes: string[] }
    | null;
}

const CATEGORIES: Category[] = ['webshop', 'erp', 'crm', 'marketing', 'communication'];

export function Catalogue({ items }: { items: CatalogueItem[] }) {
  const t = useTranslations('connections');
  const router = useRouter();
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [connecting, setConnecting] = useState<CatalogueItem | null>(null);

  const start = (item: CatalogueItem) => {
    if (item.auth?.type === 'oauth') router.push(`/connect/${item.id}`);
    else setConnecting(item);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('filterLabel')}>
        <FilterChip active={filter === 'all'} count={items.length} onClick={() => setFilter('all')}>
          {t('all')}
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c} active={filter === c} onClick={() => setFilter(c)}>
            {t(`category.${c}`)}
          </FilterChip>
        ))}
      </div>

      {CATEGORIES.filter((c) => filter === 'all' || filter === c).map((c) => (
        <section key={c} aria-labelledby={`cat-${c}`} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id={`cat-${c}`} className="m-0 text-card">
              {t(`category.${c}`)}
            </h2>
            <p className="m-0 text-meta text-fg-2">{t(`categoryHint.${c}`)}</p>
          </div>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 lg:grid-cols-4">
            {items
              .filter((i) => i.category === c)
              .map((i) => (
                <li key={i.id} className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <ConnectorLogo connector={{ name: i.name, logoUrl: i.logo ?? undefined }} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body font-semibold">{i.name}</span>
                      <span className="truncate text-meta text-fg-2">{i.subtitle}</span>
                    </div>
                    {i.connected ? (
                      <StatusPill status="ok" compact>
                        {t('connected')}
                      </StatusPill>
                    ) : !i.available ? (
                      <StatusPill status="paused" compact>
                        {t('comingSoon')}
                      </StatusPill>
                    ) : null}
                  </div>
                  <div className="mt-auto">
                    {i.available ? (
                      <Button
                        variant={i.connected ? 'secondary' : 'primary'}
                        size="s"
                        onClick={() => start(i)}
                        aria-label={`${i.connected ? t('addAccount') : t('connect')} ${i.name}`}
                      >
                        {i.connected ? t('addAccount') : t('connect')}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <p className="m-0 text-table text-fg-2">
        {t('missing')}{' '}
        <a
          href="mailto:hej@agentor.dk?subject=Manglende%20system"
          className="font-semibold text-fg-1"
        >
          {t('tellUs')}
        </a>
      </p>
      {connecting?.auth?.type === 'key' && (
        <KeyDialog item={connecting} onClose={() => setConnecting(null)} />
      )}
    </div>
  );
}

/** Auth form generated from the manifest's fields (§4.3). */
function KeyDialog({ item, onClose }: { item: CatalogueItem; onClose: () => void }) {
  const t = useTranslations('connections');
  const tc = useTranslations('common');
  const router = useRouter();
  const auth = item.auth as Extract<CatalogueItem['auth'], { type: 'key' }>;
  const [values, setValues] = useState<Record<string, string>>({});
  const [manual, setManual] = useState(!auth.live?.keyFlow);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; webhookUrl: string | null } | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await connectWithKey(item.id, values);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data?.webhookUrl && !auth.live?.autoWebhook) setDone(res.data);
      else {
        onClose();
        router.push(`/connections/${res.data!.id}`);
      }
    });

  const errorText = (e: string) => {
    if (e.startsWith('missing:')) {
      const f = auth.fields.find((x) => x.key === e.slice(8));
      return t('errors.missing', { field: f?.label ?? '' });
    }
    return t(`errors.${['httpsRequired', 'badUrl'].includes(e) ? e : 'generic'}`);
  };

  const urlField = auth.fields.find((f) => f.type === 'url');
  const goToShop = () => {
    const raw = urlField ? (values[urlField.key] ?? '').trim() : '';
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:') throw new Error('http');
      const q = new URLSearchParams({ baseUrl: u.origin, return: '/connections' });
      window.location.assign(`/connect/${item.id}/start?${q}`);
    } catch {
      setError(raw.startsWith('http:') ? 'httpsRequired' : 'badUrl');
    }
  };

  // Systems without a shop address (e-conomic): the system's own install page gives the key.
  if (!manual && !urlField)
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('liveConnect.title', { name: item.name })}
        description={t('liveConnect.installIntro', { name: item.name })}
        width={560}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" size="m" onClick={() => setManual(true)}>
              {t('liveConnect.manualToken')}
            </Button>
            <Button
              variant="primary"
              size="m"
              onClick={() =>
                window.location.assign(
                  `/connect/${item.id}/start?${new URLSearchParams({ return: '/connections' })}`,
                )
              }
            >
              {t('liveConnect.goTo', { name: item.name })}
            </Button>
          </>
        }
      >
        <p className="m-0 text-meta text-fg-2">{t('liveConnect.installHelp')}</p>
      </Dialog>
    );

  if (!manual && urlField)
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('liveConnect.title', { name: item.name })}
        width={560}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" size="m" onClick={() => setManual(true)}>
              {t('liveConnect.manual')}
            </Button>
            <Button variant="primary" size="m" onClick={goToShop}>
              {t('liveConnect.go')}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            goToShop();
          }}
        >
          {error && <Banner tone="error">{errorText(error)}</Banner>}
          <Field label={t('liveConnect.shopUrl')} help={t('liveConnect.shopUrlHelp')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="url"
                autoComplete="url"
                placeholder={urlField.placeholder}
                aria-describedby={describedBy}
                value={values[urlField.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [urlField.key]: e.target.value }))}
              />
            )}
          </Field>
        </form>
      </Dialog>
    );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={done ? t('webhookTitle') : t('connectTitle', { name: item.name })}
      description={done ? t('webhookIntro', { name: item.name }) : t('connectIntro')}
      width={560}
      closeLabel={tc('close')}
      footer={
        done ? (
          <Button variant="primary" size="m" onClick={() => router.push(`/connections/${done.id}`)}>
            {t('done')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="m" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button variant="primary" size="m" onClick={submit} loading={pending}>
              {t('connect')}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col gap-3">
          <Field label={t('webhookUrl')} help={t('webhookHelp')}>
            {({ id, describedBy }) => (
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  readOnly
                  value={done.webhookUrl!}
                  mono
                  aria-describedby={describedBy}
                />
                <CopyButton
                  value={done.webhookUrl!}
                  label={tc('copy')}
                  copiedLabel={tc('copied')}
                />
              </div>
            )}
          </Field>
          <Banner tone="info">{t('webhookOnce')}</Banner>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {error && <Banner tone="error">{errorText(error)}</Banner>}
          {auth.fields.map((f) => (
            <Field key={f.key} label={f.label} help={f.help}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type={f.type === 'secret' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                  autoComplete="off"
                  placeholder={f.placeholder}
                  aria-describedby={describedBy}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <p className="m-0 text-meta text-fg-2">{t('sealedNote')}</p>
        </form>
      )}
    </Dialog>
  );
}
