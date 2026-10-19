'use client';

import { Button, Checkbox, Icon, Input, Segmented, Textarea, cn, toast } from '@agentor/ui';
import { Lock, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addCaseEventAction } from '@/app/platform/actions';

/**
 * Reply to the customer or write an internal note (S3, P2). Internal notes are yellow, marked
 * "Intern note" and never reach the customer; they can be pinned on the customer and carry time.
 */
export function CaseComposer({
  caseId,
  compact = false,
  defaultKind = 'internal_note',
}: {
  caseId: string;
  compact?: boolean;
  defaultKind?: 'reply' | 'internal_note';
}) {
  const t = useTranslations('platform.case');
  const tc = useTranslations('common');
  const router = useRouter();
  const [kind, setKind] = useState<'reply' | 'internal_note'>(defaultKind);
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(false);
  const [withTime, setWithTime] = useState(false);
  const [minutes, setMinutes] = useState('15');
  const [pending, start] = useTransition();
  const note = kind === 'internal_note';

  const submit = () =>
    start(async () => {
      const res = await addCaseEventAction(caseId, {
        kind,
        body,
        pinToCustomer: note && pin,
        minutes: note && withTime ? Number(minutes) || 0 : 0,
      });
      if (!res.ok) {
        toast.error({ title: t('errors.generic'), closeLabel: tc('close') });
        return;
      }
      setBody('');
      setPin(false);
      setWithTime(false);
      toast.ok({ title: note ? t('noteSaved') : t('replySent'), closeLabel: tc('close') });
      router.refresh();
    });

  return (
    <div className={cn('flex flex-col gap-3 rounded-md p-3 shadow-ring-chip', note ? 'bg-note-bg' : 'bg-surface')}>
      <Segmented
        aria-label={t('composerKind')}
        value={kind}
        onValueChange={(v) => setKind(v as 'reply' | 'internal_note')}
        options={[
          { value: 'reply', label: t('replyToCustomer') },
          { value: 'internal_note', label: t('internalNote'), icon: <Icon icon={Lock} size={14} /> },
        ]}
      />
      <Textarea
        aria-label={note ? t('internalNote') : t('replyToCustomer')}
        rows={compact ? 3 : 4}
        value={body}
        placeholder={note ? t('notePlaceholder') : t('replyPlaceholder')}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {note ? (
          <span className="flex flex-wrap items-center gap-4 text-table">
            <label className="flex items-center gap-2">
              <Checkbox checked={withTime} onCheckedChange={(v) => setWithTime(v === true)} />
              {t('addTime')}
            </label>
            {withTime && (
              <Input
                aria-label={t('minutes')}
                className="w-20"
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            )}
            <label className="flex items-center gap-2">
              <Checkbox checked={pin} onCheckedChange={(v) => setPin(v === true)} />
              {t('pinToCustomer')}
            </label>
          </span>
        ) : (
          <span className="text-meta text-fg-2">{t('replyHelp')}</span>
        )}
        <Button variant="primary" size="s" loading={pending} disabled={!body.trim()} onClick={submit}>
          {!pending && <Icon icon={Send} size={14} />}
          {note ? t('saveNote') : t('send')}
        </Button>
      </div>
    </div>
  );
}
