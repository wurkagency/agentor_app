import { manifestFor } from '@agentor/connectors';
import { Responsive } from '@agentor/ui/mobile';
import { NavyCard, TrustPoints } from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import { recommendTemplates, type TEMPLATES } from '@/components/editor/templates';
import { trustPoints } from '@/components/signup/frame';
import { connectOption, onboardingData } from '@/components/signup/onboarding-data';
import { OnboardingDiagram } from '@/components/signup/onboarding-diagram';
import { OnboardingSteps, SkipLink } from '@/components/signup/onboarding-frame';
import { TemplateStep, type TemplateOption } from '@/components/signup/template-step';
import { requireSignupStep } from '@/server/signup';

export async function generateMetadata() {
  const t = await getTranslations('onboardingFlow.template');
  return { title: t('title') };
}

/**
 * OB3 / MO3: templates for the connected systems (recommended first, from template data), and one
 * for a system chosen on SU3 but not connected yet ("Kræver HubSpot").
 */
export default async function OnboardingTemplatePage() {
  const { session, tenant } = await requireSignupStep('template');
  const d = await onboardingData({ tenantId: tenant!.tenantId, userId: session!.user.id });
  const t = await getTranslations('onboardingFlow.template');
  const connected = d.connections.filter((c) => c.status === 'ok').map((c) => c.connectorId);
  const usable = recommendTemplates(connected);
  // One template that needs a system chosen on SU3 but not connected yet (e.g. "Kræver HubSpot").
  const waiting = recommendTemplates([...connected, ...d.chosen]).find(
    (x) => !usable.includes(x) && x.destinations.some((dst) => !connected.includes(dst)),
  );
  const erp = d.diagram.erp?.name ?? '';
  const option = (
    tpl: (typeof TEMPLATES)[number],
    requires: string | null,
    first: boolean,
  ): TemplateOption => {
    const dest = tpl.destinations.map((x) => connectOption(x)).filter((x) => !!x);
    const source = connectOption(tpl.source.find((s) => connected.includes(s)) ?? tpl.source[0]!);
    const name = dest[0]?.name ?? '';
    const title =
      tpl.category === 'erp'
        ? t('erpTitle')
        : tpl.category === 'crm'
          ? t('crmTitle')
          : t('marketingTitle');
    const bodyText =
      tpl.category === 'erp'
        ? t('erpBody', { erp: name })
        : tpl.category === 'crm'
          ? t('crmBody', { crm: name })
          : t('marketingBody', { name });
    return {
      id: tpl.id,
      title,
      body: bodyText,
      bodyMobile: tpl.category === 'erp' ? t('erpBodyMobile') : bodyText,
      routes: tpl.routes.map((r) =>
        t.has(`routes.${r.entity}.${tpl.category}` as 'routes.order.erp')
          ? t(`routes.${r.entity}.${tpl.category}` as 'routes.order.erp')
          : `${r.entity} → ${manifestFor(r.to)?.name ?? r.to}`,
      ),
      logos: [source, ...dest].filter((x) => !!x),
      recommended: first,
      requires,
    };
  };
  const templates = [
    ...usable.slice(0, 2).map((tpl, i) => option(tpl, null, i === 0)),
    ...(waiting
      ? [
          option(
            waiting,
            connectOption(waiting.destinations.find((x) => !connected.includes(x))!)?.name ?? null,
            false,
          ),
        ]
      : []),
  ];
  return (
    <Responsive
      desktop={
        <TemplateStep
          templates={templates}
          erpName={erp}
          topRight={<SkipLink step="template" />}
          step={<OnboardingSteps step="template" />}
          diagram={<OnboardingDiagram data={d} />}
          points={<TrustPoints points={await trustPoints()} />}
        />
      }
      mobile={
        <TemplateStep
          mobile
          templates={templates}
          erpName={erp}
          topRight={<SkipLink step="template" mobile />}
          step={<OnboardingSteps step="template" mobile />}
          diagram={
            <NavyCard>
              <OnboardingDiagram data={d} compact />
            </NavyCard>
          }
        />
      }
    />
  );
}
