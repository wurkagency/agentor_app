import { Responsive } from '@agentor/ui/mobile';
import { getTranslations } from 'next-intl/server';
import { DesktopOnly } from '@/components/mobile/desktop-only';
import { FilterStatus, UrlSegmented, withParam } from '@/components/platform/url-segmented';
import { MyTimeMobile } from './mobile';
import { TimePerCustomerView } from './per-customer';
import { TimeView } from './view';

type Scope = 'me' | 'team' | 'customer';
const SCOPES: Scope[] = ['me', 'team', 'customer'];

export async function generateMetadata() {
  const t = await getTranslations('platform.time');
  return { title: t('title') };
}

/**
 * Support › Tidsforbrug (S6, MP15). Min tid, Team and Pr. kunde are a filter in the URL
 * (?scope=me|team|customer), not routes (README decision 24). Permissions as before: every staff
 * member may see the team's time and the time per customer.
 */
export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; week?: string }>;
}) {
  const sp = await searchParams;
  const scope: Scope = SCOPES.find((s) => s === sp.scope) ?? 'me';
  const t = await getTranslations('platform.time');
  const label = (s: Scope) =>
    s === 'me' ? t('scopeMe') : s === 'team' ? t('scopeTeam') : t('scopeCustomer');
  const scopeSwitch = (
    <>
      <UrlSegmented
        label={t('scope')}
        segments={SCOPES.map((s) => ({
          href: withParam('/platform/support/time', s === 'customer' ? {} : sp, {
            scope: s === 'me' ? null : s,
          }),
          label: label(s),
          active: s === scope,
        }))}
      />
      <FilterStatus>{t('showing', { scope: label(scope) })}</FilterStatus>
    </>
  );
  if (scope === 'me')
    return (
      <Responsive
        desktop={<TimeView team={false} week={sp.week} scopeSwitch={scopeSwitch} />}
        mobile={<MyTimeMobile week={sp.week} />}
      />
    );
  return (
    <DesktopOnly area="platformAdmin" title={t('title')} platform>
      {scope === 'team' ? (
        <TimeView team week={sp.week} scopeSwitch={scopeSwitch} />
      ) : (
        <TimePerCustomerView scopeSwitch={scopeSwitch} />
      )}
    </DesktopOnly>
  );
}
