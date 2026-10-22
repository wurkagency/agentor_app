'use client';

import {
  Banner,
  Button,
  cn,
  ConnectorLogo,
  FilterChip,
  Icon,
  Input,
  SearchInput,
} from '@agentor/ui';
import { ArrowRight, Check, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { createFromTemplate } from '@/app/(app)/integrations/new/actions';
import type { Template } from './templates';

interface PickerTemplate extends Template {
  missing: string[];
  logos: { id: string; name: string; logo: string }[];
}

const CATS = ['all', 'erp', 'crm', 'marketing'] as const;

/** Skabelonvælger (D4): pick a template (or start blank), name the flow, open the editor. */
export function TemplatePicker({
  templates,
  initial,
}: {
  templates: PickerTemplate[];
  initial: string;
}) {
  const t = useTranslations('templates');
  const tn = useTranslations('templates.catalog');
  const ta = useTranslations('activity.entity');
  const [cat, setCat] = useState<(typeof CATS)[number]>('all');
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<string | null>(initial);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const title = (id: string) =>
    tn.has(`${id}.title`) ? tn(`${id}.title` as 'webshop-dinero.title') : t(`extra.${id}.title`);
  const body = (id: string) =>
    tn.has(`${id}.body`) ? tn(`${id}.body` as 'webshop-dinero.body') : t(`extra.${id}.body`);
  const list = templates.filter(
    (x) =>
      (cat === 'all' || x.category === cat) &&
      (!q.trim() || `${title(x.id)} ${body(x.id)}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const pick = templates.find((x) => x.id === chosen);

  return (
    <main id="main" className="flex flex-1 justify-center px-gutter py-8">
      <section
        className="flex w-full max-w-onboarding flex-col gap-5 rounded-md bg-surface p-6 shadow-card"
        aria-labelledby="tpl-title"
      >
        <div className="flex flex-col gap-1">
          <h1 id="tpl-title" className="m-0 text-section">
            {t('title')}
          </h1>
          <p className="m-0 text-fg-2">{t('intro')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            aria-label={t('search')}
            placeholder={t('search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {CATS.map((c) => (
            <FilterChip key={c} active={cat === c} onClick={() => setCat(c)}>
              {t(`cat.${c}`)}
            </FilterChip>
          ))}
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label={t('title')}>
          {list.map((x) => {
            const disabled = x.missing.length > 0;
            const selected = chosen === x.id;
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setChosen(x.id)}
                className={cn(
                  'relative flex cursor-pointer flex-col gap-2 rounded-node border-0 bg-surface p-4 text-left font-sans text-fg-1 shadow-ring-chip',
                  selected && 'shadow-ring-dark-2',
                )}
              >
                {selected && (
                  <span className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-primary shadow-ring-dark-2">
                    <Icon icon={Check} size={14} />
                  </span>
                )}
                <span className="flex items-center gap-2" aria-hidden>
                  {x.logos.map((l, i) => (
                    <span key={l.id} className="flex items-center gap-2">
                      {i > 0 && <Icon icon={ArrowRight} size={14} className="text-fg-2" />}
                      <ConnectorLogo connector={{ name: l.name, logoUrl: l.logo }} size={24} />
                    </span>
                  ))}
                </span>
                <span className="text-body font-semibold">{title(x.id)}</span>
                <span className="text-table text-fg-2">{body(x.id)}</span>
                <span className="flex flex-wrap gap-1">
                  {x.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-bg-base px-2 py-0.5 text-micro font-semibold"
                    >
                      {ta(tag)}
                    </span>
                  ))}
                </span>
                {x.popular && <span className="text-micro text-fg-2">{t('popular')}</span>}
                {disabled && (
                  <span className="text-micro font-semibold text-warn-fg">
                    {t('connectFirst', { names: x.missing.join(', ') })}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={chosen === null}
            onClick={() => setChosen(null)}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-node border border-dashed border-border-strong bg-transparent p-4 font-sans text-fg-1',
              chosen === null && 'shadow-ring-dark-2',
            )}
          >
            <span className="grid size-10 place-items-center rounded-full bg-bg-base">
              <Icon icon={Plus} size={18} />
            </span>
            <span className="text-body font-semibold">{t('blank')}</span>
            <span className="text-table text-fg-2">{t('blankBody')}</span>
          </button>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 shadow-hairline-t pt-4">
          <label className="flex w-80 flex-col gap-1.5 text-table font-medium">
            {t('name')}
            <Input
              value={name}
              placeholder={chosen ? title(chosen) : t('blank')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <span className="text-meta text-fg-2">{t('setupHint')}</span>
          <span className="flex gap-2">
            <Button variant="secondary" size="m" asChild>
              <Link href="/integrations">{t('cancel')}</Link>
            </Button>
            <Button
              variant="primary"
              size="m"
              loading={pending}
              disabled={Boolean(pick?.missing.length)}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await createFromTemplate(
                    chosen,
                    name || (chosen ? title(chosen) : t('blank')),
                  );
                  if (res && !res.ok)
                    setError(
                      res.error === 'missingSource'
                        ? t('errors.missingSource')
                        : t('errors.generic'),
                    );
                })
              }
            >
              {t('use')}
            </Button>
          </span>
        </div>
      </section>
    </main>
  );
}
