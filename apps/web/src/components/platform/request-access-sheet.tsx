'use client';

import { cn, toast } from '@agentor/ui';
import { BigButton, MobileCallout, MobileField, Modal, Segmented } from '@agentor/ui/mobile';
import { Info, Send, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createCaseAction, requestAccessAction } from '@/app/platform/actions';
import { MobileSelect, MobileTextarea } from '@/components/mobile/native-select';
import type { AccessTarget } from './request-access-dialog';

const NEW_CASE = 'new';
type Hours = '1' | '8' | '24';
type Scope = 'view' | 'help';

/**
 * MP09 Anmod om supportadgang: the desktop dialog (P3) as a mobile sheet with the same fields and
 * the same actions. Without an open case the reason becomes a new case, as on desktop.
 */
export function RequestAccessSheet({
  target,
  onClose,
  defaultCaseId,
}: {
  target: AccessTarget;
  onClose: () => void;
  defaultCaseId?: string | undefined;
}) {
  const t = useTranslations('platform.access');
  const tm = useTranslations('mobile.access');
  const tc = useTranslations('common');
  const router = useRouter();
  const [caseId, setCaseId] = useState(defaultCaseId ?? target.cases[0]?.id ?? NEW_CASE);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState<Hours>('8');
  const [scope, setScope] = useState<Scope>('help');
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
      onClose();
      toast.ok({
        title: res.data!.autoApproved ? t('sentApproved') : t('sent', { name: target.name }),
        closeLabel: tc('close'),
      });
      router.refresh();
    });

  const scopes: { key: Scope; title: string; body: string }[] = [
    { key: 'view', title: t('scopeView'), body: t('scopeViewBody') },
    { key: 'help', title: t('scopeHelp'), body: tm('scopeHelpBody') },
  ];

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('title')}
      description={[target.name, target.cvr ? `CVR ${target.cvr}` : null]
        .filter(Boolean)
        .join(' · ')}
      closeLabel={tc('close')}
      footer={
        <BigButton icon={Send} loading={pending} disabled={!reason.trim()} onClick={submit}>
          {t('send')}
        </BigButton>
      }
    >
      {target.requiresApproval ? (
        <MobileCallout tone="info" icon={Info} title={tm('approvalTitle')}>
          {tm('approvalBody')}
        </MobileCallout>
      ) : (
        <MobileCallout tone="info" icon={Info} title={tm('noApprovalTitle')}>
          {tm('noApprovalBody')}
        </MobileCallout>
      )}
      {error && (
        <p role="alert" className="m-0 text-table font-medium text-error-fg">
          {error}
        </p>
      )}
      <MobileField label={t('case')}>
        <MobileSelect
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          options={[
            ...target.cases.map((c) => ({ value: c.id, label: c.label })),
            { value: NEW_CASE, label: t('newCase') },
          ]}
        />
      </MobileField>
      <MobileField label={t('reason')} hint={t('reasonHelp')}>
        <MobileTextarea
          rows={3}
          maxLength={500}
          value={reason}
          placeholder={t('reasonPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
        />
      </MobileField>
      <div className="flex flex-col gap-1.5">
        <strong className="text-table">{t('duration')}</strong>
        <Segmented
          label={t('duration')}
          value={hours}
          onChange={(k) => setHours(k as Hours)}
          items={(['1', '8', '24'] as const).map((h) => ({
            key: h,
            label: t('hours', { count: Number(h) }),
          }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <strong id="access-scope" className="text-table">
          {t('scope')}
        </strong>
        <div role="group" aria-labelledby="access-scope" className="grid grid-cols-2 gap-2">
          {scopes.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={scope === s.key}
              onClick={() => setScope(s.key)}
              className={cn(
                'flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-bubble border-0 bg-surface px-3 py-2.5 text-left font-sans text-fg-1',
                scope === s.key ? 'shadow-ring-dark-2' : 'shadow-sm',
              )}
            >
              <strong className="text-m-chat">{s.title}</strong>
              <span className="text-meta font-medium text-fg-2">{s.body}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="m-0 flex items-start gap-2 text-meta font-medium text-fg-2">
        <TriangleAlert aria-hidden width={14} height={14} className="mt-0.5 flex-none" />
        {t('logged')}
      </p>
    </Modal>
  );
}
