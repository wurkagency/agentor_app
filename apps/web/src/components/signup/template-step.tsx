'use client';

import { Banner, Radio, RadioGroup } from '@agentor/ui';
import {
  MobileSignupShell,
  NavyCard,
  SignupButton,
  SignupHeading,
  SignupShell,
  TemplateCard,
  TrustPanel,
  type LogoRef,
} from '@agentor/ui/signup';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useState, useTransition, type ReactNode } from 'react';
import { createOnboardingFlow } from '@/app/(signup)/onboarding/actions';

export interface TemplateOption {
  id: string;
  title: string;
  body: string;
  bodyMobile: string;
  routes: string[];
  logos: LogoRef[];
  recommended: boolean;
  /** "Kræver HubSpot": a system that isn't connected yet. */
  requires: string | null;
}

/** OB3 / MO3: the first flow from a template, as a draft, and how invoices are created. */
export function TemplateStep({
  mobile = false,
  templates,
  erpName,
  topRight,
  step,
  diagram,
  points,
}: {
  mobile?: boolean;
  templates: TemplateOption[];
  erpName: string;
  topRight: ReactNode;
  step: ReactNode;
  diagram: ReactNode;
  points?: ReactNode;
}) {
  const t = useTranslations('onboardingFlow.template');
  const usable = templates.filter((x) => !x.requires);
  const [chosen, setChosen] = useState(usable[0]?.id ?? null);
  const [mode, setMode] = useState<'draft' | 'live'>('draft');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const qId = useId();

  const submit = () => {
    if (!chosen) return;
    setError(null);
    start(async () => {
      const r = await createOnboardingFlow({ templateId: chosen, invoiceMode: mode });
      if (r && !r.ok)
        setError(
          t(
            r.error === 'missingSource'
              ? 'errors.missingSource'
              : r.error.startsWith('missing')
                ? 'errors.missing'
                : 'errors.generic',
          ),
        );
    });
  };

  const body = (
    <>
      <SignupHeading
        mobile={mobile}
        title={t('title')}
        lead={mobile ? t('leadMobile') : t('lead')}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {templates.length === 0 ? (
        <Banner tone="info">{t('none')}</Banner>
      ) : (
        <div
          role="radiogroup"
          aria-label={t('title')}
          className={mobile ? 'flex flex-col gap-2.5' : 'flex flex-col gap-3'}
        >
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              name="template"
              mobile={mobile}
              logos={tpl.logos}
              title={tpl.title}
              body={mobile && tpl.requires ? undefined : mobile ? tpl.bodyMobile : tpl.body}
              routes={mobile && tpl.requires ? [] : tpl.routes}
              badge={
                tpl.requires
                  ? t('requires', { name: tpl.requires })
                  : tpl.recommended
                    ? t('recommended')
                    : undefined
              }
              badgeTone={tpl.requires ? 'neutral' : 'primary'}
              selected={chosen === tpl.id}
              disabled={!!tpl.requires}
              onSelect={() => setChosen(tpl.id)}
            />
          ))}
        </div>
      )}
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" aria-describedby={`${qId}-help`}>
        <legend className="mb-2.5 p-0 text-table font-semibold">
          {t('invoiceQuestion', { erp: erpName })}
        </legend>
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as 'draft' | 'live')}
          className="flex flex-col gap-2"
        >
          {(['draft', 'live'] as const).map((v) => (
            <label key={v} className="flex min-h-6 cursor-pointer items-center gap-2.5 text-body">
              <Radio value={v} />
              {v === 'draft' ? (mobile ? t('asDraftShort') : t('asDraft')) : t('bookNow')}
            </label>
          ))}
        </RadioGroup>
        <span id={`${qId}-help`} className="text-meta font-medium text-fg-2">
          {mobile ? t('invoiceHelpShort') : t('invoiceHelp')}
        </span>
      </fieldset>
      <div className={mobile ? 'mt-auto flex gap-2.5' : 'flex gap-2.5'}>
        <SignupButton
          asChild
          variant="secondary"
          mobile={mobile}
          className={mobile ? 'px-5.5' : ''}
        >
          <Link href="/onboarding/accounting">{t('back')}</Link>
        </SignupButton>
        <SignupButton mobile={mobile} grow loading={pending} disabled={!chosen} onClick={submit}>
          {pending ? t('submitting') : mobile ? t('submitShort') : t('submit')}
        </SignupButton>
      </div>
    </>
  );
  if (mobile)
    return (
      <MobileSignupShell topRight={topRight} step={step}>
        {body}
      </MobileSignupShell>
    );
  return (
    <SignupShell
      wide
      alignTop
      topRight={topRight}
      step={step}
      panel={
        <TrustPanel
          label={t('panelTitle')}
          title={t('panelTitle')}
          lead={t('panelLead')}
          points={points}
        >
          {diagram}
        </TrustPanel>
      }
    >
      {body}
    </SignupShell>
  );
}

export function MobileDiagramCard({ children }: { children: ReactNode }) {
  return <NavyCard>{children}</NavyCard>;
}
