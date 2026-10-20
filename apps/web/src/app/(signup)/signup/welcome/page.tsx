import { getBillingOverview, getSignupCompany, listInvoices } from '@agentor/db';
import { formatDate, formatMoney, type Locale } from '@agentor/i18n';
import { Icon } from '@agentor/ui';
import { Responsive } from '@agentor/ui/mobile';
import {
  LogoImg,
  MobileSignupShell,
  SignupButton,
  SignupHeading,
  SignupLogo,
  type LogoRef,
} from '@agentor/ui/signup';
import { CircleCheck } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { allSystems } from '@/components/signup/catalogue';
import { db } from '@/server/infra';
import { requireSignupStep } from '@/server/signup';
import { ensureSignupReceipt } from '@/server/signup-receipt';

export async function generateMetadata() {
  const t = await getTranslations('signupFlow.welcome');
  return { title: t('next') };
}

/** SU6 / MS6: the subscription is active (after QuickPay's verified callback), receipt and next steps. */
export default async function SignupWelcomePage() {
  const { session, tenant } = await requireSignupStep('welcome');
  const ctx = { tenantId: tenant!.tenantId, userId: session!.user.id };
  const [overview, company, invoices] = await Promise.all([
    getBillingOverview(db(), ctx),
    getSignupCompany(db(), ctx),
    listInvoices(db(), ctx),
  ]);
  if (!overview || !company) redirect('/');
  await ensureSignupReceipt(ctx, session!.user.email);
  const t = await getTranslations('signupFlow.welcome');
  const tp = await getTranslations('signupFlow.plan');
  const locale = (await getLocale()) as Locale;
  const paid = invoices.find((i) => i.kind === 'subscription' && i.status === 'paid');
  const period = overview.subscription.interval === 'year' ? tp('periodYear') : tp('periodMonth');
  const firstName = session!.user.name.split(' ')[0] ?? session!.user.name;
  const systems = allSystems();
  const chosen = company.chosenConnectors
    .map((id) => systems.find((s) => s.id === id))
    .filter((s): s is (typeof systems)[number] => !!s);
  const webshop = chosen.find((s) => s.category === 'webshop');
  const erp = chosen.find((s) => s.category === 'erp');
  const later = chosen.find((s) => s.category === 'crm' || s.category === 'marketing');
  const steps: { logo: LogoRef; title: string; text: string }[] = [
    ...(webshop
      ? [{ logo: webshop, title: t('connect', { name: webshop.name }), text: t('webshopText') }]
      : []),
    ...(erp ? [{ logo: erp, title: t('connect', { name: erp.name }), text: t('erpText') }] : []),
    ...(later
      ? [{ logo: later, title: t('later', { name: later.name }), text: t('laterText') }]
      : []),
  ];
  const rows = [
    [t('subscription'), t('subscriptionValue', { plan: overview.plan.name, period })],
    [t('paid'), paid ? formatMoney((paid.amountOre + paid.vatOre) / 100, locale) : '–'],
    [
      t('renews'),
      overview.subscription.currentPeriodEnd
        ? formatDate(overview.subscription.currentPeriodEnd, locale)
        : '–',
    ],
  ] as const;
  const lead = t('lead', {
    company: company.name,
    plan: overview.plan.name,
    period,
    email: company.billingEmail ?? session!.user.email,
  });
  const start = (mobile: boolean) => (
    <SignupButton asChild mobile={mobile} className={mobile ? 'mt-auto w-full' : 'self-start'}>
      <Link href="/onboarding/webshop">{t('start')}</Link>
    </SignupButton>
  );
  const summary = (mobile: boolean) => (
    <dl
      className={
        mobile
          ? 'm-0 flex flex-col gap-2 rounded-md bg-surface px-4 py-3.5 shadow-sm'
          : 'm-0 flex flex-col gap-2 rounded-node bg-canvas px-4 py-3.5'
      }
    >
      {rows.map(([k, v]) => (
        <div
          key={k}
          className={mobile ? 'flex justify-between text-m-chat' : 'flex justify-between text-body'}
        >
          <dt>{k}</dt>
          <dd className="m-0 tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
  const next = (mobile: boolean) => (
    <section
      aria-label={t('next')}
      className={
        mobile
          ? 'flex flex-col gap-3 rounded-md bg-navy p-4 text-on-navy'
          : 'flex flex-col gap-5 rounded-md bg-navy p-8 text-on-navy'
      }
    >
      <div className={mobile ? 'flex flex-col gap-1.5' : 'flex flex-col gap-2.5'}>
        <h2 className={mobile ? 'm-0 text-su-input' : 'm-0 text-su-panel'}>{t('next')}</h2>
        <p
          className={
            mobile ? 'm-0 text-m-note text-on-navy-muted' : 'm-0 text-su-lead text-on-navy-muted'
          }
        >
          {mobile ? t('nextLeadMobile') : t('nextLead')}
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
        {steps.map((s) => (
          <li key={s.title} className="flex items-center gap-3.5">
            <span
              className={
                mobile
                  ? 'grid size-9.5 flex-none place-items-center rounded-sm bg-white shadow-tile-m'
                  : 'grid size-12 flex-none place-items-center rounded-bubble bg-white shadow-tile'
              }
            >
              <LogoImg logo={s.logo} size={mobile ? 'sm' : 'md'} decorative />
            </span>
            <span className="flex flex-col leading-snug">
              <strong className={mobile ? 'text-m-chat' : 'text-su-input'}>{s.title}</strong>
              <span
                className={mobile ? 'text-meta text-on-navy-soft' : 'text-table text-on-navy-soft'}
              >
                {s.text}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <Responsive
      desktop={
        <div className="min-h-dvh bg-canvas">
          <header className="flex h-18 items-center px-signup-header">
            <SignupLogo />
          </header>
          <main id="main" className="flex justify-center pt-6 pb-14 px-signup">
            <div className="grid w-full max-w-welcome grid-cols-welcome items-stretch gap-6">
              <section className="flex flex-col gap-5 rounded-md bg-surface p-9 shadow-sm">
                <span className="grid size-16 place-items-center rounded-full bg-ok-bg text-ok-fg">
                  <Icon icon={CircleCheck} size={24} />
                </span>
                <SignupHeading title={t('title', { name: firstName })} lead={lead} />
                {summary(false)}
                {start(false)}
              </section>
              {next(false)}
            </div>
          </main>
        </div>
      }
      mobile={
        <MobileSignupShell>
          <SignupHeading mobile title={t('title', { name: firstName })} lead={lead} />
          {summary(true)}
          {next(true)}
          {start(true)}
        </MobileSignupShell>
      }
    />
  );
}
