import { getBillingOverview, getFlow } from '@agentor/db';
import { parseDefinition } from '@agentor/flows';
import { Icon } from '@agentor/ui';
import { Responsive } from '@agentor/ui/mobile';
import {
  LogoImg,
  MobileSignupShell,
  NavyCard,
  SignupButton,
  SignupLogo,
  type LogoRef,
} from '@agentor/ui/signup';
import { ChevronRight, Radio, Smartphone, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { templateById } from '@/components/editor/templates';
import { InviteCard } from '@/components/signup/invite-card';
import { onboardingData } from '@/components/signup/onboarding-data';
import { OnboardingDiagram } from '@/components/signup/onboarding-diagram';
import { db } from '@/server/infra';
import { requireSignupStep } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('onboardingFlow.done');
  return { title: t('liveDraft') };
}

/** OB5 / MO5: the first flow is live (as drafts), with team, the CRM chosen on SU3 and the phone. */
export default async function OnboardingDonePage() {
  const { session, tenant } = await requireSignupStep('done');
  const ctx = { tenantId: tenant!.tenantId, userId: session!.user.id };
  const d = await onboardingData(ctx);
  const [flow, overview] = await Promise.all([
    d.state?.flowId ? getFlow(db(), ctx, d.state.flowId, new Date()) : null,
    getBillingOverview(db(), ctx),
  ]);
  const t = await getTranslations('onboardingFlow.done');
  const tt = await getTranslations('onboardingFlow.template');
  const def = flow?.published ? parseDefinition(flow.published.definition) : null;
  // "Live som kladde" while any invoice route writes drafts; "Live" when everything is booked.
  const live = !!def && !def.routes.some((r) => r.mode === 'draft');
  const tpl = templateById(flow?.template ?? null);
  const flowName =
    tpl?.category === 'crm'
      ? tt('crmTitle')
      : tpl?.category === 'marketing'
        ? tt('marketingTitle')
        : tt('erpTitle');
  const erp = d.diagram.erp?.name ?? '';
  const shop =
    d.connections.find((c) => c.category === 'webshop')?.name ?? d.diagram.source?.name ?? '';
  const minutes = overview?.plan.entitlements.pollingIntervalMinutes ?? 5;
  const later = d.diagram.later;
  const domain = session!.user.email.split('@')[1] ?? 'firma.dk';
  const badge = (
    <span className="inline-flex h-6 items-center gap-1.5 self-start rounded-full bg-primary px-2.5 text-meta font-semibold text-fg-1">
      <Icon icon={Radio} size={14} />
      {live ? t('live') : t('liveDraft')}
    </span>
  );
  const laterHref = later ? `/connect/${later.id}/start?return=/connections` : '/connections/new';
  return (
    <Responsive
      desktop={
        <div className="min-h-dvh bg-canvas">
          <header className="flex h-18 items-center justify-between gap-6 px-signup-header">
            <SignupLogo />
            <span className="text-table text-fg-2">
              {session!.user.name} · {d.state?.companyName}
            </span>
          </header>
          <main id="main" className="flex justify-center pt-6 pb-14 px-signup">
            <div className="flex w-full max-w-done flex-col gap-5">
              <section className="grid grid-cols-done-hero items-center gap-8 rounded-lg bg-navy p-9 text-on-navy">
                <div className="flex flex-col gap-4">
                  {badge}
                  <h1 className="m-0 text-su-done">{t('title', { flow: flowName })}</h1>
                  <p className="m-0 max-w-signup-panel text-su-lead text-on-navy-muted">
                    {live
                      ? t('leadLive', { shop, erp, minutes })
                      : t('leadDraft', { shop, erp, minutes })}
                  </p>
                  <SignupButton asChild className="self-start">
                    <Link href="/">{t('overview')}</Link>
                  </SignupButton>
                </div>
                <OnboardingDiagram data={d} compact />
              </section>
              <div className="grid grid-cols-3 gap-4">
                <InviteCard domain={domain} />
                {later ? (
                  <LaterCard
                    logo={later}
                    title={t('addTitle', { name: later.name })}
                    text={t('addText', { name: later.name })}
                    href={laterHref}
                    action={t('addConnect', { name: later.name })}
                  />
                ) : (
                  <span />
                )}
                <section className="flex items-center gap-4 rounded-md bg-surface p-5.5 shadow-sm">
                  <img
                    src="/qr-app-agentor.svg"
                    alt={t('qrLabel')}
                    className="size-24 flex-none rounded-node shadow-ring-border"
                  />
                  <span className="flex flex-col gap-1.5">
                    <strong className="text-card">{t('qrTitle')}</strong>
                    <span className="text-table text-fg-2">{t('qrText')}</span>
                  </span>
                </section>
              </div>
            </div>
          </main>
        </div>
      }
      mobile={
        <MobileSignupShell topRight={<span>{session!.user.name}</span>}>
          <NavyCard>
            <div className="mt-0 flex flex-col gap-3.5">
              {badge}
              <h1 className="m-0 text-m-heading">{t('title', { flow: flowName })}</h1>
              <p className="m-0 text-m-chat text-on-navy-muted">
                {live
                  ? t('leadLiveMobile', { erp, minutes })
                  : t('leadDraftMobile', { erp, minutes })}
              </p>
              <OnboardingDiagram data={d} compact />
              <SignupButton asChild mobile className="w-full">
                <Link href="/">{t('overview')}</Link>
              </SignupButton>
            </div>
          </NavyCard>
          <ul className="m-0 list-none overflow-hidden rounded-md bg-surface p-0 shadow-sm">
            <MobileRow
              href="/settings/team"
              icon={<Icon icon={Users} size={18} />}
              title={t('inviteTitle')}
              text={t('inviteTextMobile')}
            />
            {later && (
              <MobileRow
                href={laterHref}
                icon={<LogoImg logo={later} size="sm" decorative />}
                title={t('addTitle', { name: later.name })}
                text={t('addTextMobile')}
              />
            )}
            <MobileRow
              href="/install"
              icon={<Icon icon={Smartphone} size={18} />}
              title={t('installTitle')}
              text={t('installText')}
            />
          </ul>
        </MobileSignupShell>
      }
    />
  );
}

function LaterCard({
  logo,
  title,
  text,
  href,
  action,
}: {
  logo: LogoRef;
  title: string;
  text: string;
  href: string;
  action: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md bg-surface p-5.5 shadow-sm">
      <span className="grid size-10 place-items-center rounded-node shadow-ring-border">
        <LogoImg logo={logo} size="md" decorative />
      </span>
      <strong className="text-card">{title}</strong>
      <span className="text-table text-fg-2">{text}</span>
      <a
        href={href}
        className="inline-flex h-7 items-center self-start rounded-full bg-white px-3 text-meta font-semibold text-fg-1 no-underline shadow-ring-strong"
      >
        {action}
      </a>
    </section>
  );
}

function MobileRow({
  href,
  icon,
  title,
  text,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <li className="shadow-row-divider">
      <a
        href={href}
        className="flex min-h-14 items-center gap-3 px-4 py-2.5 text-fg-1 no-underline"
      >
        <span className="grid size-9 flex-none place-items-center rounded-field bg-bg-base">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <strong className="truncate text-body">{title}</strong>
          <span className="truncate text-meta font-medium text-fg-2">{text}</span>
        </span>
        <Icon icon={ChevronRight} size={16} className="text-fg-2" />
      </a>
    </li>
  );
}
