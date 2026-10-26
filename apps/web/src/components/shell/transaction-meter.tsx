import { formatNumber } from '@agentor/i18n';
import { cn } from '@agentor/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { requireAppContext } from '@/server/auth/session';
import { billingOverview } from '@/server/billing-overview';

/**
 * Transaction meter on the right of the secondary bar (App-skal-B): this month's Live writes
 * against the plan. Owners can click through to Abonnement.
 */
export async function TransactionMeter() {
  const ctx = await requireAppContext();
  const o = await billingOverview(ctx);
  if (!o) return null;
  const t = await getTranslations('billing');
  const locale = (await getLocale()) as 'da' | 'en';
  const { used, limit, level } = o.quota;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const value = `${formatNumber(used, locale)} / ${limit === null ? t('unlimited') : formatNumber(limit, locale)}`;
  const body = (
    <>
      <span className="text-meta font-medium text-fg-2">{t('transactions')}</span>
      <span
        role="meter"
        aria-label={t('transactions')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={value}
        className="h-1.5 w-18 overflow-hidden rounded-full bg-bg-base"
      >
        <span
          className={cn(
            'block h-full rounded-full',
            level === 'ok' ? 'bg-primary' : level === 'warn' ? 'bg-warn-fg' : 'bg-error-fg',
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tabular text-meta font-semibold text-fg-1">{value}</span>
    </>
  );
  const className = 'hidden items-center gap-2.5 whitespace-nowrap no-underline md:flex';
  return ctx.tenant.role === 'owner' ? (
    <Link href="/billing" className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
