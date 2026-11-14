'use client';

import { Banner, Button, Dialog, Field, Icon, Input, Select, Textarea, toast } from '@agentor/ui';
import { CalendarClock, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveIncidentAction } from '@/app/platform/admin/status/actions';

type Kind = 'incident' | 'maintenance';
type Status = 'planned' | 'investigating' | 'monitoring' | 'resolved' | 'completed';

export interface IncidentValue {
  id: string;
  kind: Kind;
  title: string;
  impact: string;
  status: Status;
  startsAt: string;
  endsAt: string | null;
  notes: string;
}

const STATUSES: Record<Kind, Status[]> = {
  incident: ['investigating', 'monitoring', 'resolved'],
  maintenance: ['planned', 'completed'],
};

/** "2026-10-21T13:40" in the browser's time zone, for <input type="datetime-local">. */
function local(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/**
 * "Opret hændelse", "Planlæg vedligehold" (A1) and "Opdatér hændelse" (MP25): one dialog. The
 * row lands in platform.incidents and the platform audit log.
 */
export function IncidentButton({
  kind,
  incident,
  variant = 'primary',
}: {
  kind: Kind;
  incident?: IncidentValue;
  variant?: 'primary' | 'secondary';
}) {
  const t = useTranslations('platform.adminStatus');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(incident?.title ?? '');
  const [impact, setImpact] = useState(incident?.impact ?? '');
  const [status, setStatus] = useState<Status>(
    incident?.status ?? (kind === 'maintenance' ? 'planned' : 'investigating'),
  );
  const [startsAt, setStartsAt] = useState(local(incident?.startsAt ?? new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(local(incident?.endsAt ?? null));
  const [notes, setNotes] = useState(incident?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = incident
    ? t('update')
    : kind === 'maintenance'
      ? t('planMaintenance')
      : t('create');
  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveIncidentAction(
        {
          kind,
          title,
          impact,
          status,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          notes,
        },
        incident?.id,
      );
      if (!res.ok) {
        setError(t('error'));
        return;
      }
      setOpen(false);
      toast.ok({ title: t('saved'), closeLabel: tc('close') });
      router.refresh();
    });
  return (
    <>
      <Button
        variant={incident ? 'secondary' : variant}
        size={incident ? 's' : 'm'}
        onClick={() => setOpen(true)}
      >
        {!incident && <Icon icon={kind === 'maintenance' ? CalendarClock : Plus} size={16} />}
        {label}
      </Button>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          width={560}
          title={label}
          closeLabel={tc('close')}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" size="m" onClick={() => setOpen(false)}>
                {tc('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                loading={pending}
                disabled={!title.trim()}
                onClick={save}
              >
                {t('save')}
              </Button>
            </div>
          }
        >
          {error && <Banner tone="error">{error}</Banner>}
          <Field label={t('fieldTitle')}>
            {({ id }) => (
              <Input
                id={id}
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('fieldImpact')} help={t('fieldImpactHelp')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={impact}
                maxLength={300}
                onChange={(e) => setImpact(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('fieldStatus')}>
            {({ id }) => (
              <Select
                id={id}
                value={status}
                onValueChange={(v) => setStatus(v as Status)}
                options={STATUSES[kind].map((s) => ({ value: s, label: t(`status.${s}`) }))}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('fieldStart')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('fieldEnd')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label={t('fieldNotes')}>
            {({ id }) => (
              <Textarea
                id={id}
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
        </Dialog>
      )}
    </>
  );
}
