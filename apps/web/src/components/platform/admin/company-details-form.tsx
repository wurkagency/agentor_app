'use client';

import { Banner, Button, Card, CardHeader, Field, Input, toast } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveCompanyDetailsAction } from '@/app/platform/admin/product/actions';

export interface CompanyDetails {
  companyName: string;
  companyAddress: string;
  companyPostalCity: string;
  companyCvr: string;
  companyEmail: string;
  bankReg: string;
  bankAccount: string;
  bankIban: string;
}

const FIELDS: { key: keyof CompanyDetails; label: string; width: string; inputMode?: 'numeric' }[] =
  [
    { key: 'companyName', label: 'name', width: 'max-w-80' },
    { key: 'companyAddress', label: 'address', width: 'max-w-80' },
    { key: 'companyPostalCity', label: 'postalCity', width: 'max-w-80' },
    { key: 'companyCvr', label: 'cvr', width: 'max-w-40', inputMode: 'numeric' },
    { key: 'companyEmail', label: 'email', width: 'max-w-80' },
    { key: 'bankReg', label: 'bankReg', width: 'max-w-24', inputMode: 'numeric' },
    { key: 'bankAccount', label: 'bankAccount', width: 'max-w-40', inputMode: 'numeric' },
    { key: 'bankIban', label: 'iban', width: 'max-w-80' },
  ];

/**
 * "Firmaoplysninger på fakturaer" (A2): Agentor's own details on invoices and credit notes
 * (I01/I02). Until they are filled in, the documents print the boards' placeholders.
 */
export function CompanyDetailsForm({ initial }: { initial: CompanyDetails }) {
  const t = useTranslations('platform.product.company');
  const tc = useTranslations('common');
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await saveCompanyDetailsAction(values);
      setError(!res.ok);
      if (!res.ok) return;
      toast.ok({ title: t('saved'), closeLabel: tc('close') });
      router.refresh();
    });
  return (
    <Card>
      <CardHeader title={t('title')} />
      <p className="m-0 mt-1 mb-4 text-table text-fg-2">{t('intro')}</p>
      {error && <Banner tone="error">{t('error')}</Banner>}
      <div className="flex flex-col gap-3">
        {FIELDS.map((f) => (
          <Field key={f.key} label={t(f.label)}>
            {({ id }) => (
              <Input
                id={id}
                className={`w-full ${f.width}`}
                {...(f.inputMode ? { inputMode: f.inputMode } : {})}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
      </div>
      <div className="mt-4">
        <Button variant="primary" size="m" loading={pending} onClick={save}>
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}
