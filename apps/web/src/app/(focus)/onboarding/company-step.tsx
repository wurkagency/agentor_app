'use client';

import { Banner, Button, Field, Icon, Input, Select } from '@agentor/ui';
import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { CvrCompany } from '@/server/cvr';
import { createCompanyStep, lookupCvr } from './actions';
import { ORDERS_PER_MONTH } from './options';

type Mode = 'lookup' | 'found' | 'manual';

const KNOWN = new Set([
  'cvrFormat',
  'cvrNotFound',
  'cvrUnavailable',
  'lookupFirst',
  'nameRequired',
  'email',
  'phone',
  'TENANT_LIMIT',
]);

const errorKey = (e: string) => (KNOWN.has(e) ? e : 'generic');

export function CompanyStep({ locale }: { locale: 'da' | 'en' }) {
  const t = useTranslations('onboarding');
  const [cvr, setCvr] = useState('');
  const [mode, setMode] = useState<Mode>('lookup');
  const [found, setFound] = useState<CvrCompany | null>(null);
  const [manual, setManual] = useState({ name: '', addressLine: '', postalCode: '', city: '' });
  const [billingEmail, setBillingEmail] = useState('');
  const [smsPhone, setSmsPhone] = useState('');
  const [orders, setOrders] = useState('');
  const [busy, setBusy] = useState<'lookup' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onLookup() {
    setError(null);
    setBusy('lookup');
    const res = await lookupCvr(cvr);
    setBusy(null);
    if (res.ok && res.data) {
      setFound(res.data);
      setMode('found');
      return;
    }
    setFound(null);
    const code = res.ok ? 'cvrNotFound' : res.error;
    setError(code);
    if (code === 'cvrNotFound' || code === 'cvrUnavailable') setMode('manual');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const company =
      mode === 'found' && found
        ? {
            name: found.name,
            addressLine: found.addressLine ?? '',
            postalCode: found.postalCode ?? '',
            city: found.city ?? '',
          }
        : manual;
    if (!company.name.trim()) {
      setError(mode === 'lookup' ? 'lookupFirst' : 'nameRequired');
      return;
    }
    setBusy('save');
    const res = await createCompanyStep({
      ...company,
      cvr: mode === 'found' ? (found?.cvr ?? '') : cvr,
      billingEmail,
      smsPhone,
      ordersPerMonth: orders || null,
      locale,
    });
    // Success redirects; we only get here on an error.
    setBusy(null);
    if (!res.ok) setError(res.error);
  }

  const setM = (k: keyof typeof manual) => (e: ChangeEvent<HTMLInputElement>) =>
    setManual((m) => ({ ...m, [k]: e.target.value }));

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      {error && <Banner tone="error">{t(`errors.${errorKey(error)}`)}</Banner>}
      <Field label={t('cvr')}>
        {({ id }) => (
          <div className="flex gap-2">
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="off"
              maxLength={11}
              value={cvr}
              onChange={(e) => setCvr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void onLookup();
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="m"
              onClick={onLookup}
              loading={busy === 'lookup'}
            >
              {t('lookup')}
            </Button>
          </div>
        )}
      </Field>

      {mode === 'found' && found && (
        <div
          className="flex items-center gap-3 rounded-sm bg-ok-bg px-4 py-3"
          role="status"
          aria-live="polite"
        >
          <Icon icon={CircleCheck} size={16} className="text-ok-fg" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-table font-semibold">{found.name}</span>
            <span className="text-meta text-fg-2">
              {[found.addressLine, [found.postalCode, found.city].filter(Boolean).join(' ')]
                .filter(Boolean)
                .join(', ')}
              {found.since ? ` · ${t('activeSince', { year: found.since })}` : ''}
            </span>
            {!found.active && (
              <span className="text-meta font-medium text-warn-fg">{t('ceased')}</span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="s"
            onClick={() => {
              setMode('manual');
              setManual({
                name: found.name,
                addressLine: found.addressLine ?? '',
                postalCode: found.postalCode ?? '',
                city: found.city ?? '',
              });
            }}
          >
            {t('notIt')}
          </Button>
        </div>
      )}

      {mode === 'lookup' && (
        <button
          type="button"
          className="self-start border-0 bg-transparent p-0 text-table font-semibold text-fg-1 underline"
          onClick={() => setMode('manual')}
        >
          {t('enterManually')}
        </button>
      )}

      {mode === 'manual' && (
        <div className="flex flex-col gap-4">
          <Field label={t('name')}>
            {({ id }) => (
              <Input
                id={id}
                autoComplete="organization"
                value={manual.name}
                onChange={setM('name')}
              />
            )}
          </Field>
          <Field label={t('address')}>
            {({ id }) => (
              <Input
                id={id}
                autoComplete="street-address"
                value={manual.addressLine}
                onChange={setM('addressLine')}
              />
            )}
          </Field>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('postalCode')}>
              {({ id }) => (
                <Input
                  id={id}
                  autoComplete="postal-code"
                  inputMode="numeric"
                  value={manual.postalCode}
                  onChange={setM('postalCode')}
                />
              )}
            </Field>
            <Field label={t('city')} className="md:col-span-2">
              {({ id }) => (
                <Input
                  id={id}
                  autoComplete="address-level2"
                  value={manual.city}
                  onChange={setM('city')}
                />
              )}
            </Field>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('billingEmail')}>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('smsPhone')}>
          {({ id }) => (
            <Input
              id={id}
              type="tel"
              autoComplete="tel"
              value={smsPhone}
              onChange={(e) => setSmsPhone(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label={t('orders')} help={t('ordersHelp')}>
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={orders}
            onValueChange={setOrders}
            placeholder={t('ordersPlaceholder')}
            options={ORDERS_PER_MONTH.map((o) => ({ value: o, label: t(`ordersOption.${o}`) }))}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="l" loading={busy === 'save'}>
          {t('continue')}
        </Button>
      </div>
    </form>
  );
}
