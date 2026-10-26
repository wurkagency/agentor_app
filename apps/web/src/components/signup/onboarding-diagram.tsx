import { ConnectionDiagram, type DiagramNode } from '@agentor/ui/signup';
import { getTranslations } from 'next-intl/server';
import type { onboardingData } from './onboarding-data';

type Data = Awaited<ReturnType<typeof onboardingData>>;

/** The diagram on OB3–OB5, where both connections already exist (server-rendered). */
export async function OnboardingDiagram({
  data,
  compact = false,
}: {
  data: Data;
  compact?: boolean;
}) {
  const t = await getTranslations('onboardingFlow.diagram');
  const node = (
    o: Data['diagram']['source'],
    fallback: string,
    later = false,
  ): DiagramNode | null => {
    if (!o) return null;
    if (later) return { logo: o, title: o.name, detail: t('later'), state: 'later' };
    const c = data.connections.find((x) => x.connectorId === o.id);
    if (c?.status === 'ok')
      return {
        logo: o,
        title: o.name,
        detail: c.accounts ? t('connectedAccounts') : t('connected'),
        state: 'connected',
      };
    if (c?.status === 'broken')
      return { logo: o, title: o.name, detail: t('failed'), state: 'error' };
    return { logo: o, title: o.name, detail: fallback, state: c ? 'connecting' : 'idle' };
  };
  const source = node(data.diagram.source, t('webshop'));
  if (!source) return null;
  const dests = [
    node(data.diagram.erp, t('erp')),
    node(data.diagram.later, t('later'), true),
  ].filter((n): n is DiagramNode => !!n);
  return (
    <ConnectionDiagram
      compact={compact}
      label={t('label')}
      source={source}
      agentor={{ title: t('agentor'), detail: t('agentorDetail') }}
      destinations={dests}
    />
  );
}
