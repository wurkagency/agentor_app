import { activeGrantsAll, getPlatformSettings, listStaff } from '@agentor/db';
import { formatDate, formatRelative, type Locale } from '@agentor/i18n';
import { Avatar, Card, Icon, Table, Td, Th, Tr } from '@agentor/ui';
import { CircleCheck, Headphones, ShieldCheck, Triangle, TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { InviteStaffButton, RulesForm, StaffRowMenu } from '@/components/platform/staff-controls';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { RightsTable } from './rights';

export async function generateMetadata() {
  const t = await getTranslations('platform.users');
  return { title: t('title') };
}

/** Platformbrugere og roller (P6): Agentor's staff, their roles and the access rules. */
export default async function StaffPage() {
  const { actor } = await requireStaff(true);
  const t = await getTranslations('platform.users');
  const locale = (await getLocale()) as Locale;
  const [staff, grants, settings] = await Promise.all([
    listStaff(db(), actor),
    activeGrantsAll(db(), actor.userId),
    getPlatformSettings(db(), actor.userId),
  ]);
  const now = new Date();
  return (
    <PageBody>
      <PageHeader title={t('title')} subtitle={t('intro')} actions={<InviteStaffButton />} />
      <Card padding="none" className="overflow-x-auto">
        <Table aria-label={t('staff')}>
          <thead>
            <tr>
              <Th className="pl-5">{t('colStaff')}</Th>
              <Th>{t('colRole')}</Th>
              <Th>{t('colAccess')}</Th>
              <Th>{t('colLastActive')}</Th>
              <Th>{t('colMfa')}</Th>
              <Th numeric>{t('colGrants')}</Th>
              <Th className="pr-5">
                <span className="sr-only">{t('colMenu')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <Tr key={s.userId} className={s.disabled ? 'opacity-60' : undefined}>
                <Td className="pl-5">
                  <span className="flex items-center gap-3">
                    <Avatar name={s.name} size={32} tone="navy" />
                    <span className="flex flex-col leading-tight">
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-meta text-fg-2">{s.email}</span>
                    </span>
                  </span>
                </Td>
                <Td>
                  {s.role === 'superadmin' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-micro font-semibold text-on-navy">
                      <Icon icon={Triangle} size={14} className="fill-primary text-primary" />
                      {t('roles.superadmin')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-bg-base px-2.5 py-1 text-micro font-semibold shadow-ring-chip">
                      <Icon icon={Headphones} size={14} />
                      {t('roles.supporter')}
                    </span>
                  )}
                </Td>
                <Td>
                  {s.disabled
                    ? t('disabled')
                    : [
                        s.role === 'superadmin' ? t('accessAll') : t('accessSupport'),
                        s.probationUntil ? t('probationUntil', { date: formatDate(s.probationUntil, locale) }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </Td>
                <Td className="text-fg-2">{s.lastActiveAt ? formatRelative(s.lastActiveAt, now, locale) : '–'}</Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 text-meta">
                    <Icon
                      icon={s.twoFactor ? CircleCheck : TriangleAlert}
                      size={14}
                      className={s.twoFactor ? 'text-ok-fg' : 'text-warn-fg'}
                    />
                    {s.twoFactor ? t('mfaOn') : t('mfaOff')}
                  </span>
                </Td>
                <Td numeric>{grants.filter((g) => g.staffUserId === s.userId).length}</Td>
                <Td className="pr-5 text-right">
                  <StaffRowMenu userId={s.userId} email={s.email} role={s.role} self={s.userId === actor.userId} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RightsTable />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card className="flex flex-col gap-4">
            <h2 className="m-0 text-card">{t('rulesTitle')}</h2>
            <RulesForm
              warnConcurrent={settings.warnConcurrentGrants}
              hourlyRateKr={settings.hourlyRateOre === null ? null : settings.hourlyRateOre / 100}
              showRate={false}
            />
          </Card>
          <Card className="flex items-start gap-3">
            <Icon icon={ShieldCheck} size={18} className="mt-0.5" />
            <span className="flex flex-col gap-1">
              <strong className="text-body">{t('noStanding')}</strong>
              <span className="text-table text-fg-2">{t('noStandingBody')}</span>
            </span>
          </Card>
        </div>
      </div>
    </PageBody>
  );
}
