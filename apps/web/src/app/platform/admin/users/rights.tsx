import { Card, Icon, Table, Td, Th, Tr } from '@agentor/ui';
import { Check, X } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/** Rettigheder pr. rolle (P6). The database enforces these; the table explains them. */
export const RIGHTS: [key: string, superadmin: boolean, supporter: boolean][] = [
  ['seeCustomers', true, true],
  ['requestAccess', true, true],
  ['helpInApp', true, true],
  ['openDirect', true, false],
  ['seeKeys', false, false],
  ['changeTeam', false, false],
  ['manageStaff', true, false],
  ['changePlans', true, false],
  ['seeAudit', true, false],
];

export async function RightsTable() {
  const t = await getTranslations('platform.users');
  const cell = (on: boolean) => (
    <span className="inline-flex items-center gap-1.5 text-meta">
      <Icon icon={on ? Check : X} size={14} className={on ? 'text-ok-fg' : 'text-fg-2'} />
      {on ? t('yes') : t('no')}
    </span>
  );
  return (
    <Card padding="none" className="overflow-x-auto">
      <h2 className="m-0 px-5 pb-2 pt-5 text-card">{t('rightsTitle')}</h2>
      <Table aria-label={t('rightsTitle')}>
        <thead>
          <tr>
            <Th className="pl-5">{t('right')}</Th>
            <Th>{t('roles.superadmin')}</Th>
            <Th className="pr-5">{t('roles.supporter')}</Th>
          </tr>
        </thead>
        <tbody>
          {RIGHTS.map(([key, sa, sup]) => (
            <Tr key={key}>
              <Td className="whitespace-normal pl-5">{t(`rights.${key}`)}</Td>
              <Td>{cell(sa)}</Td>
              <Td className="pr-5">{cell(sup)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
