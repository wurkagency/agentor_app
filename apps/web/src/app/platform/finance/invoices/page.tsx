import { formatMinutes, type Locale } from '@agentor/i18n';
import { cn } from '@agentor/ui';
import { MobileCard, MobileEmpty, MobileShell, Responsive } from '@agentor/ui/mobile';
import { CircleCheck } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { PlatformTopBar } from '@/components/mobile/chrome';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { dayMonth, money, monthLong } from '@/components/platform/finance/bits';
import {
  daysBetween,
  financeInvoicesAll,
  needsAction,
  paymentState,
  subscriptionRows,
} from '@/server/finance-data';
import { requireStaff } from '@/server/platform';
import { NotifyInvoice } from './notify';

export async function generateMetadata() {
  const t = await getTranslations('mobile.platform.overdue');
  return { title: t('title') };
}

/**
 * MP07 Forfaldne betalinger (`?status=overdue`): one card per invoice that needs action, with a
 * reminder or a payment link behind a confirm modal. On a computer this is Fakturaer og
 * betalinger (F6), so the desktop branch goes there.
 */
export default async function OverdueInvoicesPage() {
  const { actor } = await requireStaff(true);
  const t = await getTranslations('mobile.platform.overdue');
  const tf = await getTranslations('platform.finance');
  const locale = (await getLocale()) as Locale;
  const now = new Date();
  const [invoices, subs] = await Promise.all([
    financeInvoicesAll(actor),
    subscriptionRows(actor, now),
  ]);
  const subBy = new Map(subs.map((s) => [s.tenantId, s]));
  const list = invoices
    .map((i) => ({ i, s: paymentState(i, now) }))
    .filter((x) => needsAction(x.s))
    .sort((a, b) => (a.i.dueAt?.getTime() ?? 0) - (b.i.dueAt?.getTime() ?? 0));
  const total = list.reduce((a, x) => a + x.i.grossOre, 0);

  const mobile = (
    <MobileShell topBar={<PlatformTopBar back="/platform/finance" title={t('title')} />}>
      {list.length === 0 ? (
        <MobileEmpty icon={CircleCheck} title={t('none')} />
      ) : (
        <>
          <p className="m-0 mx-1 text-meta font-medium text-fg-2">
            {t('subtitle', { count: list.length, amount: money(total, locale) })}
          </p>
          {list.map(({ i, s }) => {
            const sub = subBy.get(i.tenantId);
            const minutes = i.lines.reduce((a, l) => a + (l.registeredMinutes ?? 0), 0);
            const what =
              i.kind === 'support'
                ? `${tf('kind.support')} ${monthLong(i.periodStart, locale)}${minutes ? ` · ${formatMinutes(minutes, locale)}` : ''}`
                : `${tf('kind.subscription')} ${sub?.planName ?? ''} · ${monthLong(i.periodStart, locale)}`;
            const pill =
              s === 'overdue'
                ? { text: t('overdueDays', { days: daysBetween(i.dueAt!, now) }), warn: false }
                : s === 'reminded'
                  ? { text: t('reminded', { count: i.reminders }), warn: false }
                  : s === 'card_failed'
                    ? { text: t('cardDeclined'), warn: false }
                    : {
                        text: t('retrying', { date: dayMonth(i.nextRetryAt ?? now, locale) }),
                        warn: true,
                      };
            const kind = s === 'overdue' || s === 'reminded' ? 'reminder' : 'payment_link';
            const label =
              s === 'overdue'
                ? t('sendReminder')
                : s === 'reminded'
                  ? t('reminderN', { n: i.reminders + 1 })
                  : t('paymentLink');
            const amount = money(i.grossOre, locale);
            const email = sub?.billingEmail ?? null;
            const invoice = i.number ?? '–';
            return (
              <MobileCard key={i.id} className="flex flex-col gap-2 px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex flex-col leading-snug">
                    <strong className="text-card">{i.tenantName}</strong>
                    <span className="text-meta text-fg-2">{what}</span>
                  </span>
                  <strong className="whitespace-nowrap text-card tabular">{amount}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'inline-flex h-6 items-center rounded-full px-2.5 text-micro font-semibold text-fg-1',
                      pill.warn ? 'bg-warn-bg' : 'bg-error-bg',
                    )}
                  >
                    {pill.text}
                  </span>
                  <NotifyInvoice
                    tenantId={i.tenantId}
                    invoiceId={i.id}
                    kind={kind}
                    label={label}
                    name={i.tenantName}
                    hasEmail={email !== null}
                    body={
                      email
                        ? t('confirmBody', { invoice, amount, email })
                        : t('confirmBodyNoEmail', { invoice, amount })
                    }
                  />
                </div>
              </MobileCard>
            );
          })}
        </>
      )}
    </MobileShell>
  );
  return (
    <Responsive
      mobile={mobile}
      desktop={<DesktopRedirect href="/platform/finance/invoicing" label={tf('tab.invoicing')} />}
    />
  );
}
