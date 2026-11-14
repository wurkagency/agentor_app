'use client';

import {
  Banner,
  Button,
  Dialog,
  Field,
  Icon,
  RadioCard,
  RadioGroup,
  Segmented,
  Select,
  Textarea,
  toast,
} from '@agentor/ui';
import { Send, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createCaseAction, requestAccessAction } from '@/app/platform/actions';

export interface AccessTarget {
  tenantId: string;
  name: string;
  cvr: string | null;
  requiresApproval: boolean;
  cases: { id: string; label: string }[];
}

const NEW_CASE = 'new';

/**
 * Anmod om supportadgang (P3): a case, a reason the customer reads, 1, 8 or 24 hours and the
 * scope. Without an open case the reason becomes a new case, so access is always tied to one.
 */
export function RequestAccessDialog({
  target: initial,
  choices,
  open,
  onOpenChange,
  defaultCaseId,
}: {
  target: AccessTarget;
  /** Support › Adgange (S9): the customer is picked in the dialog from these. */
  choices?: AccessTarget[] | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCaseId?: string | undefined;
}) {
  const t = useTranslations('platform.access');
  const tc = useTranslations('common');
  const router = useRouter();
  const [target, setTarget] = useState(initial);
  const [caseId, setCaseId] = useState(defaultCaseId ?? initial.cases[0]?.id ?? NEW_CASE);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState<'1' | '8' | '24'>('8');
  const [scope, setScope] = useState<'view' | 'help'>('help');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      let id: string | null = caseId === NEW_CASE ? null : caseId;
      if (!id) {
        const c = await createCaseAction({
          tenantId: target.tenantId,
          title: reason.trim().slice(0, 120),
          body: '',
          priority: 'normal',
          category: 'question',
        });
        if (!c.ok) return setError(t('errors.generic'));
        id = c.data!.id;
      }
      const res = await requestAccessAction({
        tenantId: target.tenantId,
        caseId: id,
        reason,
        hours: Number(hours) as 1 | 8 | 24,
        scope,
      });
      if (!res.ok)
        return setError(
          t(`errors.${res.error === 'SUPPORT_CASE_AND_REASON_REQUIRED' ? 'reason' : 'generic'}`),
        );
      onOpenChange(false);
      toast.ok({
        title: res.data!.autoApproved ? t('sentApproved') : t('sent', { name: target.name }),
        closeLabel: tc('close'),
      });
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={560}
      title={t('title')}
      description={[target.name, target.cvr ? `CVR ${target.cvr}` : null]
        .filter(Boolean)
        .join(' · ')}
      closeLabel={tc('close')}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-fg-2">
            {target.requiresApproval ? t('startsOnApproval') : t('startsNow')}
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" size="m" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              size="m"
              loading={pending}
              disabled={!reason.trim()}
              onClick={submit}
            >
              {!pending && <Icon icon={Send} size={16} />}
              {t('send')}
            </Button>
          </span>
        </div>
      }
    >
      {target.requiresApproval ? (
        <Banner tone="warn">{t('approvalNeeded')}</Banner>
      ) : (
        <Banner tone="info">{t('noApproval')}</Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {choices && choices.length > 1 && (
        <Field label={t('customer')} inline>
          {({ id }) => (
            <Select
              id={id}
              value={target.tenantId}
              onValueChange={(v) => {
                const next = choices.find((c) => c.tenantId === v);
                if (!next) return;
                setTarget(next);
                setCaseId(next.cases[0]?.id ?? NEW_CASE);
              }}
              options={choices.map((c) => ({ value: c.tenantId, label: c.name }))}
            />
          )}
        </Field>
      )}
      <Field label={t('case')} inline>
        {({ id }) => (
          <Select
            id={id}
            value={caseId}
            onValueChange={setCaseId}
            options={[
              ...target.cases.map((c) => ({ value: c.id, label: c.label })),
              { value: NEW_CASE, label: t('newCase') },
            ]}
          />
        )}
      </Field>
      <Field label={t('reason')} help={t('reasonHelp')}>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            rows={3}
            maxLength={500}
            value={reason}
            placeholder={t('reasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('duration')} inline>
        {() => (
          <Segmented
            aria-label={t('duration')}
            value={hours}
            onValueChange={(v) => setHours(v as '1' | '8' | '24')}
            options={[
              { value: '1', label: t('hours', { count: 1 }) },
              { value: '8', label: t('hours', { count: 8 }) },
              { value: '24', label: t('hours', { count: 24 }) },
            ]}
          />
        )}
      </Field>
      <fieldset className="m-0 grid grid-cols-1 gap-3 border-0 p-0 md:grid-cols-3">
        <legend className="mb-2 text-table font-medium">{t('scope')}</legend>
        <RadioGroup
          value={scope}
          onValueChange={(v) => setScope(v as 'view' | 'help')}
          aria-label={t('scope')}
          className="col-span-full flex flex-col gap-3"
        >
          <RadioCard value="view" title={t('scopeView')} description={t('scopeViewBody')} />
          <RadioCard value="help" title={t('scopeHelp')} description={t('scopeHelpBody')} />
        </RadioGroup>
      </fieldset>
      <p className="m-0 flex items-start gap-2 text-meta text-fg-2">
        <Icon icon={TriangleAlert} size={14} className="mt-0.5" />
        {t('logged')}
      </p>
    </Dialog>
  );
}
