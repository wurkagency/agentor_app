'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Banner, Card, Field, Input, Select, toast } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { FormFooter } from '@/components/form-footer';
import { saveCompany } from './actions';
import { companySchema, type CompanyForm } from './schema';

export function CompanyFormView({ initial }: { initial: CompanyForm }) {
  const t = useTranslations('company');
  const common = useTranslations('common');
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    defaultValues: initial,
    mode: 'onBlur',
  });
  const { register, control, handleSubmit, formState, reset } = form;
  const err = (name: keyof CompanyForm) => {
    const m = formState.errors[name]?.message;
    return m ? t(`errors.${m}` as 'errors.name') : undefined;
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const r = await saveCompany(values);
    if (r.ok) {
      reset(values);
      toast.ok({ title: t('saved'), closeLabel: common('close') });
    } else setError(r.error);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-form">
      <Card padding="none">
        <div className="flex flex-col gap-5 p-6">
          {error && <Banner tone="error">{t(`errors.${error}` as 'errors.name')}</Banner>}
          <Field label={t('name')} error={err('name')}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                autoComplete="organization"
                {...register('name')}
              />
            )}
          </Field>
          <Field label={t('cvr')} error={err('cvr')}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                inputMode="numeric"
                className="w-48"
                {...register('cvr')}
              />
            )}
          </Field>
          <Field label={t('address')}>
            {({ id }) => (
              <Input id={id} autoComplete="street-address" {...register('addressLine')} />
            )}
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label={t('postalCode')}>
              {({ id }) => <Input id={id} autoComplete="postal-code" {...register('postalCode')} />}
            </Field>
            <Field label={t('city')} className="col-span-2">
              {({ id }) => <Input id={id} autoComplete="address-level2" {...register('city')} />}
            </Field>
          </div>
          <Field label={t('billingEmail')} error={err('billingEmail')}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                type="email"
                {...register('billingEmail')}
              />
            )}
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label={t('language')}>
              {({ id }) => (
                <Controller
                  control={control}
                  name="locale"
                  render={({ field }) => (
                    <Select
                      id={id}
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        { value: 'da', label: t('danish') },
                        { value: 'en', label: t('english') },
                      ]}
                    />
                  )}
                />
              )}
            </Field>
            <Field label={t('timeZone')}>
              {({ id }) => (
                <Controller
                  control={control}
                  name="timeZone"
                  render={({ field }) => (
                    <Select
                      id={id}
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        'Europe/Copenhagen',
                        'Europe/Stockholm',
                        'Europe/Oslo',
                        'Europe/Berlin',
                        'Europe/London',
                      ].map((z) => ({
                        value: z,
                        label: z.replace('Europe/', ''),
                      }))}
                    />
                  )}
                />
              )}
            </Field>
            <Field label={t('currency')}>
              {({ id }) => (
                <Controller
                  control={control}
                  name="currency"
                  render={({ field }) => (
                    <Select
                      id={id}
                      value={field.value}
                      onValueChange={field.onChange}
                      options={['DKK', 'EUR', 'SEK', 'NOK'].map((c) => ({ value: c, label: c }))}
                    />
                  )}
                />
              )}
            </Field>
          </div>
        </div>
        <FormFooter
          dirty={formState.isDirty}
          saving={formState.isSubmitting}
          onCancel={() => reset(initial)}
        />
      </Card>
    </form>
  );
}
