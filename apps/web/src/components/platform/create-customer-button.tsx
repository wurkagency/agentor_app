'use client';

import { Banner, Button, Dialog, Field, Icon, Input, Select } from '@agentor/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createCustomerAction, lookupCustomerCvr } from '@/app/platform/customers/actions';

interface Form {
  name: string;
  cvr: string;
  addressLine: string;
  postalCode: string;
  city: string;
  ownerEmail: string;
  billingEmail: string;
  planId: string;
  interval: 'month' | 'year';
}

/** "Opret kunde" on /platform/customers (Superadmin): company, plan and the owner's invitation. */
export function CreateCustomerButton({ plans }: { plans: { id: string; name: string }[] }) {
  const t = useTranslations('platform.customers.create');
  const tco = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const empty: Form = {
    name: '',
    cvr: '',
    addressLine: '',
    postalCode: '',
    city: '',
    ownerEmail: '',
    billingEmail: '',
    planId: plans.find((p) => p.id === 'business')?.id ?? plans[0]?.id ?? '',
    interval: 'month',
  };
  const [f, setF] = useState<Form>(empty);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const lookup = () =>
    start(async () => {
      setError(null);
      setNote(null);
      const r = await lookupCustomerCvr(f.cvr);
      if (!r.ok || !r.data)
        return setNote(t(`cvr.${r.ok ? 'notFound' : r.error}` as 'cvr.notFound'));
      const c = r.data;
      setF((x) => ({
        ...x,
        name: c.name,
        addressLine: c.addressLine ?? '',
        postalCode: c.postalCode ?? '',
        city: c.city ?? '',
      }));
      setNote(c.active ? t('cvr.found', { name: c.name }) : t('cvr.ceased', { name: c.name }));
    });

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await createCustomerAction(f);
      if (!r.ok || !r.data) {
        setError(t(`errors.${r.ok ? 'generic' : r.error}` as 'errors.generic'));
        return;
      }
      setOpen(false);
      setF(empty);
      router.push(
        `/platform/customers/${r.data.tenantId}${r.data.mailed ? '?created=1' : '?created=nomail'}`,
      );
    });

  return (
    <>
      <Button variant="primary" size="m" onClick={() => setOpen(true)}>
        <Icon icon={Plus} size={16} />
        {t('open')}
      </Button>
      {open && (
        <Dialog
          open
          onOpenChange={(o) => !o && setOpen(false)}
          width={560}
          title={t('title')}
          description={t('help')}
          closeLabel={tco('close')}
          footer={
            <span className="flex gap-2">
              <Button variant="secondary" size="m" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                loading={pending}
                disabled={!f.name.trim() || !f.ownerEmail.trim() || !f.planId}
                onClick={submit}
              >
                {t('submit')}
              </Button>
            </span>
          }
        >
          {error && <Banner tone="error">{error}</Banner>}
          <Field label={t('cvr.label')} help={note ?? t('cvr.help')}>
            {({ id, describedBy }) => (
              <span className="flex gap-2">
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  maxLength={8}
                  value={f.cvr}
                  onChange={set('cvr')}
                />
                <Button
                  variant="secondary"
                  size="m"
                  disabled={!/^\d{8}$/.test(f.cvr) || pending}
                  onClick={lookup}
                >
                  {t('cvr.lookup')}
                </Button>
              </span>
            )}
          </Field>
          <Field label={t('name')}>
            {({ id }) => <Input id={id} maxLength={160} value={f.name} onChange={set('name')} />}
          </Field>
          <Field label={t('address')}>
            {({ id }) => (
              <Input id={id} maxLength={160} value={f.addressLine} onChange={set('addressLine')} />
            )}
          </Field>
          <span className="grid grid-cols-2 gap-3">
            <Field label={t('postalCode')}>
              {({ id }) => (
                <Input id={id} maxLength={10} value={f.postalCode} onChange={set('postalCode')} />
              )}
            </Field>
            <Field label={t('city')}>
              {({ id }) => <Input id={id} maxLength={80} value={f.city} onChange={set('city')} />}
            </Field>
          </span>
          <Field label={t('ownerEmail')} help={t('ownerEmailHelp')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="email"
                autoComplete="off"
                value={f.ownerEmail}
                onChange={set('ownerEmail')}
              />
            )}
          </Field>
          <Field label={t('billingEmail')} help={t('billingEmailHelp')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="email"
                autoComplete="off"
                value={f.billingEmail}
                onChange={set('billingEmail')}
              />
            )}
          </Field>
          <span className="grid grid-cols-2 gap-3">
            <Field label={t('plan')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={f.planId}
                  onValueChange={(v) => setF((x) => ({ ...x, planId: v }))}
                  options={plans.map((p) => ({ value: p.id, label: p.name }))}
                />
              )}
            </Field>
            <Field label={t('interval')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={f.interval}
                  onValueChange={(v) => setF((x) => ({ ...x, interval: v as 'month' | 'year' }))}
                  options={[
                    { value: 'month', label: t('month') },
                    { value: 'year', label: t('year') },
                  ]}
                />
              )}
            </Field>
          </span>
        </Dialog>
      )}
    </>
  );
}
