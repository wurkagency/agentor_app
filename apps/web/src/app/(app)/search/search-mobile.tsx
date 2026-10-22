'use client';

import { formatTime, type Locale } from '@agentor/i18n';
import { Icon } from '@agentor/ui';
import {
  MobileCard,
  MobileEmpty,
  MobileFootnote,
  MobileLogo,
  MobileShell,
  RowIcon,
  RowLink,
  SectionHeading,
  type LogoRef,
} from '@agentor/ui/mobile';
import { CircleCheck, CircleMinus, CircleX, RotateCw, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { searchPalette } from '@/app/actions/notifications';
import { AppTopBar } from '@/components/mobile/chrome';

interface RecordHit {
  label: string;
  customer: string | null;
  outcome: string;
  flowId: string;
  at: string;
}

const OUTCOMES = ['created', 'updated', 'skipped', 'failed', 'would_create', 'would_update'];

/** MA17: the ⌘K palette's groups as cards, searched as you type (D1-Soeg). */
export function SearchMobile({
  initialQuery,
  initialRecords,
  flows,
  connections,
  failuresToday,
}: {
  initialQuery: string;
  initialRecords: RecordHit[];
  flows: { id: string; name: string; routes: number; logo: LogoRef }[];
  connections: { id: string; label: string; logo: LogoRef }[];
  failuresToday: number;
}) {
  const t = useTranslations('mobile.search');
  const tp = useTranslations('palette');
  const locale = useLocale() as Locale;
  const inputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [records, setRecords] = useState(initialRecords);
  const [searching, setSearching] = useState(false);
  const q = query.trim();

  // Order numbers and customers on the server, like the palette; the URL keeps the term for back.
  useEffect(() => {
    const url = q ? `/search?q=${encodeURIComponent(q)}` : '/search';
    window.history.replaceState(window.history.state, '', url);
    if (q.length < 2) {
      setRecords([]);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const id = setTimeout(() => {
      void searchPalette(q).then((rows) => {
        if (!live) return;
        setRecords(rows);
        setSearching(false);
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);

  const needle = q.toLocaleLowerCase(locale);
  const matches = (s: string) => !needle || s.toLocaleLowerCase(locale).includes(needle);
  const shownFlows = flows.filter((f) => matches(f.name));
  const shownConns = connections.filter((c) => matches(c.label));
  const today = new Date().toDateString();
  const when = (iso: string) => {
    const d = new Date(iso);
    return d.toDateString() === today
      ? formatTime(d, locale)
      : new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: 'Europe/Copenhagen',
        }).format(d);
  };
  const nothing = q.length > 0 && !records.length && !shownFlows.length && !shownConns.length;

  return (
    <MobileShell topBar={<AppTopBar back="/" title={t('title')} />}>
      <div className="flex h-12 items-center gap-2 rounded-full bg-white pl-4 text-fg-2 shadow-ring-dark-2 outline-offset-2 focus-within:outline-2 focus-within:outline-fg-1">
        <Icon icon={Search} size={18} />
        <label htmlFor={inputId} className="sr-only">
          {t('label')}
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="search"
          autoFocus
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('placeholder')}
          className="h-full min-w-0 flex-1 border-0 bg-transparent font-sans text-m-input text-fg-1 outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('clear')}
            className="grid size-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-1"
          >
            <Icon icon={X} size={18} />
          </button>
        )}
      </div>
      <p className="sr-only" role="status">
        {searching ? t('searching') : ''}
      </p>

      {nothing && !searching ? (
        <MobileEmpty icon={Search} title={tp('empty')}>
          {t('noOrders', { q })}
        </MobileEmpty>
      ) : (
        <>
          <SectionHeading>{tp('records')}</SectionHeading>
          {records.length > 0 ? (
            <MobileCard>
              {records.map((r) => {
                const outcome = OUTCOMES.includes(r.outcome) ? r.outcome : 'created';
                return (
                  <RowLink
                    key={r.label}
                    href={`/activity?q=${encodeURIComponent(r.label)}&period=30d`}
                    linkAs={Link}
                    leading={
                      <RowIcon
                        icon={
                          r.outcome === 'failed'
                            ? CircleX
                            : r.outcome === 'skipped'
                              ? CircleMinus
                              : CircleCheck
                        }
                        tone={
                          r.outcome === 'failed'
                            ? 'error'
                            : r.outcome === 'skipped'
                              ? 'neutral'
                              : 'ok'
                        }
                      />
                    }
                    title={r.customer ? `${r.label} · ${r.customer}` : r.label}
                    meta={t('orderMeta', {
                      outcome: tp(`outcome.${outcome}` as 'outcome.created'),
                      when: when(r.at),
                      flow: flows.find((f) => f.id === r.flowId)?.name ?? '',
                    })}
                  />
                );
              })}
            </MobileCard>
          ) : (
            <MobileFootnote>
              {q.length < 2 ? t('hint') : searching ? t('searching') : t('noOrders', { q })}
            </MobileFootnote>
          )}

          {shownFlows.length + shownConns.length > 0 && (
            <>
              <SectionHeading>{tp('flowsAndConnections')}</SectionHeading>
              <MobileCard>
                {shownFlows.map((f) => (
                  <RowLink
                    key={f.id}
                    href={`/integrations/${f.id}`}
                    linkAs={Link}
                    leading={<MobileLogo {...f.logo} />}
                    title={f.name}
                    meta={tp('flowDetail', { count: f.routes })}
                  />
                ))}
                {shownConns.map((c) => (
                  <RowLink
                    key={c.id}
                    href={`/connections/${c.id}`}
                    linkAs={Link}
                    leading={<MobileLogo {...c.logo} />}
                    title={c.label}
                    meta={tp('connectionDetail')}
                  />
                ))}
              </MobileCard>
            </>
          )}

          {failuresToday > 0 && (
            <>
              <SectionHeading>{tp('quickActions')}</SectionHeading>
              <MobileCard>
                <RowLink
                  href="/activity?outcome=failed"
                  linkAs={Link}
                  leading={<RowIcon icon={RotateCw} tone="lime" />}
                  title={tp('retryAll')}
                  meta={tp('failuresToday', { count: failuresToday })}
                />
              </MobileCard>
            </>
          )}
        </>
      )}
    </MobileShell>
  );
}
