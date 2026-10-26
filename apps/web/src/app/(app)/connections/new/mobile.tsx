'use client';

import type { Category } from '@agentor/connectors';
import { CopyButton, Icon, StatusPill } from '@agentor/ui';
import {
  BigButton,
  ChipGroup,
  MobileCallout,
  MobileCard,
  MobileEmpty,
  MobileField,
  MobileFootnote,
  MobileInput,
  MobileLogo,
  MobileShell,
  Modal,
  Row,
  SectionHeading,
} from '@agentor/ui/mobile';
import { CircleAlert, Info, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AppTopBar } from '@/components/mobile/chrome';
import { connectWithKey } from '../actions';
import type { CatalogueItem } from './catalogue';

const CATEGORIES: Category[] = ['webshop', 'erp', 'crm', 'marketing', 'communication'];

/**
 * MA27 Tilføj forbindelse: search, category chips and the systems in cards. Connect starts the
 * same flows as D9-Katalog (OAuth in the browser, or the key form). Systems on the way are left
 * out.
 */
export function CatalogueMobile({ items: all }: { items: CatalogueItem[] }) {
  // Only systems that can be connected today: no "på vej" rows (user decision on MA27).
  const items = all.filter((i) => i.available);
  const t = useTranslations('connections');
  const tm = useTranslations('mobile.catalog');
  const router = useRouter();
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const [connecting, setConnecting] = useState<CatalogueItem | null>(null);
  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (i) =>
      (filter === 'all' || i.category === filter) &&
      (!q || i.name.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q)),
  );

  const start = (item: CatalogueItem) => {
    if (item.auth?.type === 'oauth') router.push(`/connect/${item.id}`);
    else setConnecting(item);
  };

  const trailing = (i: CatalogueItem) => {
    if (i.connected)
      return (
        <StatusPill status="ok" compact>
          {t('connected')}
        </StatusPill>
      );
    return (
      <button
        type="button"
        onClick={() => start(i)}
        aria-label={tm('connectLabel', { name: i.name })}
        className="touch-target inline-flex h-8.5 flex-none cursor-pointer items-center rounded-full border-0 bg-primary px-3.5 font-sans text-meta font-semibold text-fg-1"
      >
        {t('connect')}
      </button>
    );
  };

  return (
    <MobileShell topBar={<AppTopBar back="/connections" title={t('add')} />}>
      <label className="flex h-11 items-center gap-2 rounded-full bg-white px-4 text-fg-2 shadow-sm">
        <Icon icon={Search} size={18} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tm('search')}
          aria-label={tm('search')}
          className="min-w-0 flex-1 border-0 bg-transparent font-sans text-m-input text-fg-1 outline-none"
        />
      </label>
      <ChipGroup
        label={t('filterLabel')}
        value={filter}
        onChange={(k) => setFilter(k as Category | 'all')}
        items={[
          { key: 'all', label: tm('allCount', { count: items.length }) },
          ...CATEGORIES.filter((c) => items.some((i) => i.category === c)).map((c) => ({
            key: c,
            label: t(`category.${c}`),
          })),
        ]}
      />
      {visible.length === 0 ? (
        <MobileEmpty icon={Search} title={tm('noMatch')}>
          {tm('noMatchBody')}
        </MobileEmpty>
      ) : (
        CATEGORIES.map((c) => {
          const group = visible.filter((i) => i.category === c);
          if (group.length === 0) return null;
          return (
            <section key={c} aria-labelledby={`m-cat-${c}`} className="flex flex-col gap-3">
              <SectionHeading>
                <span id={`m-cat-${c}`}>{t(`category.${c}`)}</span>
              </SectionHeading>
              <MobileCard>
                {group.map((i) => (
                  <Row
                    key={i.id}
                    leading={<MobileLogo name={i.name} logoUrl={i.logo ?? undefined} size={32} />}
                    title={i.name}
                    meta={i.subtitle}
                    trailing={trailing(i)}
                  />
                ))}
              </MobileCard>
            </section>
          );
        })
      )}
      <MobileFootnote>{tm('footnote')}</MobileFootnote>
      <MobileFootnote>
        {t('missing')}{' '}
        <a
          href="mailto:hej@agentor.dk?subject=Manglende%20system"
          className="font-semibold text-fg-1"
        >
          {t('tellUs')}
        </a>
      </MobileFootnote>
      {connecting?.auth?.type === 'key' && (
        <KeyModal item={connecting} onClose={() => setConnecting(null)} />
      )}
    </MobileShell>
  );
}

/** The key form from the manifest's fields, as a mobile modal (same action as D9 KeyDialog). */
function KeyModal({ item, onClose }: { item: CatalogueItem; onClose: () => void }) {
  const t = useTranslations('connections');
  const tc = useTranslations('common');
  const router = useRouter();
  const auth = item.auth as Extract<CatalogueItem['auth'], { type: 'key' }>;
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [webhook, setWebhook] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const finish = () => {
    onClose();
    router.push('/connections');
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await connectWithKey(item.id, values);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data?.webhookUrl) setWebhook(res.data.webhookUrl);
      else finish();
    });

  const errorText = (e: string) => {
    if (e.startsWith('missing:')) {
      const f = auth.fields.find((x) => x.key === e.slice(8));
      return t('errors.missing', { field: f?.label ?? '' });
    }
    return t(`errors.${['httpsRequired', 'badUrl'].includes(e) ? e : 'generic'}`);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) {
          if (webhook) finish();
          else onClose();
        }
      }}
      title={webhook ? t('webhookTitle') : t('connectTitle', { name: item.name })}
      closeLabel={tc('close')}
      footer={
        webhook ? (
          <BigButton onClick={finish}>{t('done')}</BigButton>
        ) : (
          <div className="flex gap-2">
            <BigButton variant="secondary" className="flex-1" onClick={onClose}>
              {tc('cancel')}
            </BigButton>
            <BigButton className="flex-1" loading={pending} onClick={submit}>
              {t('connect')}
            </BigButton>
          </div>
        )
      }
    >
      {webhook ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-body text-fg-2">{t('webhookIntro', { name: item.name })}</p>
          <MobileField label={t('webhookUrl')} hint={t('webhookHelp')}>
            <MobileInput readOnly value={webhook} className="font-mono" />
          </MobileField>
          <CopyButton value={webhook} label={tc('copy')} copiedLabel={tc('copied')} />
          <MobileCallout tone="info" icon={Info} title={t('webhookOnce')} />
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="m-0 text-body text-fg-2">{t('connectIntro')}</p>
          {error && <MobileCallout tone="error" icon={CircleAlert} title={errorText(error)} />}
          {auth.fields.map((f) => (
            <MobileField key={f.key} label={f.label} {...(f.help ? { hint: f.help } : {})}>
              <MobileInput
                type={f.type === 'secret' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                autoComplete="off"
                {...(f.placeholder ? { placeholder: f.placeholder } : {})}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </MobileField>
          ))}
          <p className="m-0 text-meta font-medium text-fg-2">{t('sealedNote')}</p>
        </form>
      )}
    </Modal>
  );
}
