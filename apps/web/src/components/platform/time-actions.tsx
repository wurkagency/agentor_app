'use client';

import { Button, Dialog, Field, Icon, Select, toast } from '@agentor/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { linkSessionAction } from '@/app/platform/actions';
import { AddTimeDialog } from './time-panel';

/** "Registrér tid" (S6): manual time without a case, or on one picked in the dialog. */
export function RegisterTimeButton() {
  const t = useTranslations('platform.time');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="l" onClick={() => setOpen(true)}>
        <Icon icon={Plus} size={16} />
        {t('register')}
      </Button>
      {open && (
        <AddTimeDialog caseId={null} caseLabel={t('noCase')} plan="–" total={0} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** "Knyt til sag" (S6): a logged session without a case gets one. */
export function LinkSessionButton({
  sessionId,
  cases,
}: {
  sessionId: string;
  cases: { id: string; label: string }[];
}) {
  const t = useTranslations('platform.time');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [caseId, setCaseId] = useState(cases[0]?.id ?? '');
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="secondary" size="s" onClick={() => setOpen(true)} disabled={cases.length === 0}>
        {t('link')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        width={480}
        title={t('link')}
        description={t('linkHelp')}
        closeLabel={tc('close')}
        footer={
          <span className="flex gap-2">
            <Button variant="secondary" size="m" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              size="m"
              loading={pending}
              disabled={!caseId}
              onClick={() =>
                start(async () => {
                  const res = await linkSessionAction(sessionId, caseId);
                  if (!res.ok) return void toast.error({ title: t('error'), closeLabel: tc('close') });
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {t('link')}
            </Button>
          </span>
        }
      >
        <Field label={t('case')} inline>
          {({ id }) => (
            <Select id={id} value={caseId} onValueChange={setCaseId} options={cases.map((c) => ({ value: c.id, label: c.label }))} />
          )}
        </Field>
      </Dialog>
    </>
  );
}
