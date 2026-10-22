'use client';

import { Banner, Button, Dialog, Field, Input, Select, Textarea } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createCaseAction } from '@/app/platform/actions';

/** "Ny sag" (S1): a case opened by staff, assigned to them and set to I gang. */
export function NewCaseDialog({
  customers,
  onClose,
  defaultTenantId,
  defaultTitle = '',
}: {
  customers: { id: string; name: string }[];
  onClose: () => void;
  defaultTenantId?: string;
  defaultTitle?: string;
}) {
  const t = useTranslations('platform.cases');
  const tc = useTranslations('platform.case');
  const tco = useTranslations('common');
  const router = useRouter();
  const [tenantId, setTenantId] = useState(defaultTenantId ?? customers[0]?.id ?? '');
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [category, setCategory] = useState('question');
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={560}
      title={t('new')}
      description={t('newHelp')}
      closeLabel={tco('close')}
      footer={
        <span className="flex gap-2">
          <Button variant="secondary" size="m" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            variant="primary"
            size="m"
            loading={pending}
            disabled={!tenantId || !title.trim()}
            onClick={() =>
              start(async () => {
                const res = await createCaseAction({ tenantId, title, body, priority, category });
                if (!res.ok) return setError(true);
                onClose();
                router.push(`/platform/support/cases/${res.data!.id}`);
              })
            }
          >
            {t('create')}
          </Button>
        </span>
      }
    >
      {error && <Banner tone="error">{tc('errors.generic')}</Banner>}
      <Field label={t('customer')} inline>
        {({ id }) => (
          <Select
            id={id}
            value={tenantId}
            onValueChange={setTenantId}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
      </Field>
      <Field label={t('titleField')}>
        {({ id }) => (
          <Input id={id} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        )}
      </Field>
      <Field label={t('firstNote')} help={t('firstNoteHelp')}>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('priority')} inline>
        {({ id }) => (
          <Select
            id={id}
            value={priority}
            onValueChange={setPriority}
            options={['critical', 'high', 'normal', 'low'].map((p) => ({
              value: p,
              label: tc(`priority.${p}`),
            }))}
          />
        )}
      </Field>
      <Field label={t('category')} inline>
        {({ id }) => (
          <Select
            id={id}
            value={category}
            onValueChange={setCategory}
            options={[
              'error',
              'mapping',
              'connection',
              'setup',
              'subscription',
              'wish',
              'question',
            ].map((k) => ({
              value: k,
              label: tc(`category.${k}`),
            }))}
          />
        )}
      </Field>
    </Dialog>
  );
}
