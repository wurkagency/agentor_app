import { getCompany } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/secondary-nav';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/infra';
import { CompanyFormView } from './company-form';

export async function generateMetadata() {
  const t = await getTranslations('company');
  return { title: t('title') };
}

/** Virksomhed (App-skal-B-Indstillinger; the form has no board, built from the form pattern). */
export default async function CompanyPage() {
  const ctx = await requireRole(['owner', 'admin']);
  const company = await getCompany(db(), { tenantId: ctx.tenant.tenantId, userId: ctx.user.id });
  if (!company) notFound();
  const t = await getTranslations('company');
  const nav = await getTranslations('nav');
  return (
    <PageBody>
      <PageHeader eyebrow={nav('settings')} title={t('title')} subtitle={t('intro')} />
      <CompanyFormView
        initial={{
          name: company.name,
          cvr: company.cvr ?? '',
          addressLine: company.addressLine ?? '',
          postalCode: company.postalCode ?? '',
          city: company.city ?? '',
          billingEmail: company.billingEmail ?? '',
          locale: company.locale === 'en' ? 'en' : 'da',
          timeZone: company.timeZone as 'Europe/Copenhagen',
          currency: company.currency as 'DKK',
        }}
      />
    </PageBody>
  );
}
