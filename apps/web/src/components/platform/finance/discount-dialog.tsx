'use client';

import { Banner, Button, Dialog, Field, Icon, Input, Select, toast } from '@agentor/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setDiscountAction } from '@/app/platform/finance/actions';

/** "Tilføj rabat" (F2): a percentage off the plan price, optionally until a date. */
export function DiscountButton({
  customers,
}: {
  customers: { tenantId: string; name: string; discountPct: number | null }[];
}) {
  const t = useTranslations('platform.finance.discount');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState(customers[0]?.tenantId ?? '');
  const [pct, setPct] = useState('10');
  const [until, setUntil] = useState('');
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const current = customers.find((c) => c.tenantId === tenantId);
  const save = (value: number | null) =>
    start(async () => {
      const res = await setDiscountAction({
        tenantId,
        pct: value,
        until: value && until ? until : null,
      });
      if (!res.ok) return setError(true);
      setOpen(false);
      toast.ok({ title: value ? t('saved') : t('removed'), closeLabel: tc('close') });
      router.refresh();
    });
  return (
    <>
      <Button variant="primary" size="l" onClick={() => setOpen(true)}>
        <Icon icon={Plus} size={16} />
        {t('add')}
      </Button>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          width={560}
          title={t('title')}
          description={t('help')}
          closeLabel={tc('close')}
          footer={
            <span className="flex gap-2">
              {current?.discountPct ? (
                <Button variant="secondary" size="m" loading={pending} onClick={() => save(null)}>
                  {t('remove')}
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="m"
                loading={pending}
                disabled={!tenantId || !(Number(pct) >= 1 && Number(pct) <= 100)}
                onClick={() => save(Number(pct))}
              >
                {t('save')}
              </Button>
            </span>
          }
        >
          {error && <Banner tone="error">{t('error')}</Banner>}
          <Field label={t('customer')} inline>
            {({ id }) => (
              <Select
                id={id}
                value={tenantId}
                onValueChange={setTenantId}
                options={customers.map((c) => ({
                  value: c.tenantId,
                  label: c.discountPct ? `${c.name} · ${c.discountPct} %` : c.name,
                }))}
              />
            )}
          </Field>
          <Field label={t('pct')} inline>
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                className="w-24"
                value={pct}
                onChange={(e) => setPct(e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
            )}
          </Field>
          <Field label={t('until')} help={t('untilHelp')} inline>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                className="w-44"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            )}
          </Field>
        </Dialog>
      )}
    </>
  );
}
