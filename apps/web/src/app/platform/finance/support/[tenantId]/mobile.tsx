import { formatMinutes, type Locale } from '@agentor/i18n';
import { Icon } from '@agentor/ui';
import {
  KV,
  MobileCard,
  MobileFootnote,
  MobileShell,
  Row,
  SectionHeading,
} from '@agentor/ui/mobile';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { dayMonth, money, monthLong } from '@/components/platform/finance/bits';
import {
  MobileDraftActions,
  MobileRemoveLine,
  MobileRoundingSwitch,
  MobileTimelogSwitch,
} from '@/components/platform/finance/mobile-actions';
import type { Month } from '@/server/finance-data';

export interface SupportInvoiceMobileData {
  tenantId: string;
  name: string;
  m: Month;
  lines: {
    text: string;
    detail: string;
    registered: number;
    billed: number;
    rate: number | null;
    amount: number;
    manual: number | null;
  }[];
  net: number;
  vat: number;
  /** "Kladde", "Godkendt af …", "Sendt · 2026-1043". */
  state: string;
  /** Position in the month's run, or null when the customer has no support this month. */
  position: { n: number; total: number } | null;
  prevHref: string | null;
  nextHref: string | null;
  sendAt: Date;
  email: string | null;
  method: string;
  methodMeta: string;
  invoice: { id: string; attachTimelog: boolean; approved: boolean } | null;
  editable: boolean;
  showRounding: boolean;
  roundingHref: string;
  nonBillableMinutes: number;
}

const STEP =
  'grid size-11 flex-none place-items-center rounded-full bg-surface text-fg-1 no-underline shadow-sm';

/** MP21 Supportfaktura (F5): the month's draft for one customer, approved by Superadmin. */
export async function SupportInvoiceMobile({ d }: { d: SupportInvoiceMobileData }) {
  const t = await getTranslations('mobile.supportInvoice');
  const tf = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const time = new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Copenhagen',
  }).format(d.sendAt);
  const runDate = dayMonth(d.m.end, locale);
  return (
    <MobileShell
      topBar={
        <PlatformTopBar
          back={`/platform/finance/support?month=${d.m.key}`}
          title={tf('draft.title')}
          subtitle={`${d.name} · ${monthLong(d.m.start, locale)}`}
          bell={false}
        />
      }
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-meta font-medium text-fg-2">
          {d.position
            ? t('position', {
                state: d.state,
                n: d.position.n,
                total: d.position.total,
                date: runDate,
              })
            : d.state}
        </span>
        <span className="flex gap-1">
          {d.prevHref && (
            <Link href={d.prevHref} className={STEP}>
              <Icon icon={ArrowLeft} size={18} label={tf('previous')} />
            </Link>
          )}
          {d.nextHref && (
            <Link href={d.nextHref} className={STEP}>
              <Icon icon={ArrowRight} size={18} label={tf('next')} />
            </Link>
          )}
        </span>
      </div>

      <MobileCard label={tf('draft.title')}>
        {d.lines.map((l) => {
          const [, number, rest] = /^(#\d+)\s*(.*)$/.exec(l.text) ?? [null, null, l.text];
          const rate = l.rate === null ? null : money(l.rate, locale);
          return (
            <div
              key={`${l.text}-${l.manual ?? ''}`}
              className="flex items-start gap-3 px-4 py-2.5 shadow-row-divider"
            >
              <span className="flex min-w-0 flex-1 flex-col leading-snug">
                <strong className="text-body font-semibold">
                  {number && <span className="font-mono font-normal text-fg-2">{number} </span>}
                  {rest}
                </strong>
                {l.detail && <span className="text-meta font-medium text-fg-2">{l.detail}</span>}
                {l.manual === null && (
                  <span className="text-meta font-medium text-fg-2 tabular">
                    {d.showRounding
                      ? t('rounded', {
                          registered: formatMinutes(l.registered, locale),
                          billed: formatMinutes(l.billed, locale),
                          rate: rate ?? '–',
                        })
                      : t('billed', { billed: formatMinutes(l.billed, locale), rate: rate ?? '–' })}
                  </span>
                )}
              </span>
              <strong className="whitespace-nowrap text-table tabular">
                {money(l.amount, locale)}
              </strong>
              {l.manual !== null && d.editable && (
                <MobileRemoveLine
                  tenantId={d.tenantId}
                  month={d.m.key}
                  index={l.manual}
                  text={l.text}
                />
              )}
            </div>
          );
        })}
        {d.lines.length === 0 && (
          <p className="m-0 px-4 py-3.5 text-body text-fg-2 shadow-row-divider">
            {tf('noSupport')}
          </p>
        )}
        <div className="flex flex-col px-4 pb-3.5 pt-1.5">
          <KV k={tf('draft.subtotal')}>
            <span className="tabular">{money(d.net, locale)}</span>
          </KV>
          <KV k={tf('draft.vat')}>
            <span className="tabular">{money(d.vat, locale)}</span>
          </KV>
          <KV k={<strong className="text-fg-1">{tf('draft.total')}</strong>}>
            <strong className="tabular">{money(d.net + d.vat, locale)}</strong>
          </KV>
        </div>
      </MobileCard>

      <SectionHeading>{tf('draft.sending')}</SectionHeading>
      <MobileCard>
        <Row
          title={t('sendsAt', { date: dayMonth(d.sendAt, locale), time })}
          meta={d.email ? t('to', { email: d.email }) : t('noEmail')}
        />
        <Row title={d.method} meta={d.methodMeta} />
        {d.invoice && (
          <Row
            title={tf('draft.attachTimelog')}
            meta={t('timelogMeta')}
            trailing={
              <MobileTimelogSwitch
                tenantId={d.tenantId}
                invoiceId={d.invoice.id}
                attach={d.invoice.attachTimelog}
                disabled={!d.editable}
                label={tf('draft.attachTimelog')}
              />
            }
          />
        )}
        <Row
          title={tf('draft.showRounding')}
          trailing={
            <MobileRoundingSwitch
              checked={d.showRounding}
              href={d.roundingHref}
              label={tf('draft.showRounding')}
            />
          }
        />
      </MobileCard>
      {d.nonBillableMinutes > 0 && (
        <MobileFootnote>
          {tf('draft.notBilled', { time: formatMinutes(d.nonBillableMinutes, locale) })}
        </MobileFootnote>
      )}
      <MobileDraftActions
        tenantId={d.tenantId}
        month={d.m.key}
        invoiceId={d.invoice?.id ?? null}
        approved={d.invoice?.approved ?? false}
        editable={d.editable}
      />
    </MobileShell>
  );
}
