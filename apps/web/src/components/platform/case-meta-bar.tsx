'use client';

import { formatRelative, type Locale } from '@agentor/i18n';
import { Avatar, Button, Icon, Select, toast } from '@agentor/ui';
import { BellOff, BellRing, Clock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { followCaseAction, updateCaseAction } from '@/app/platform/actions';
import type { CaseStatusKey, Priority } from './case-bits';

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Status, priority, assignee, category, deadline and followers of a case (S3). */
export function CaseMetaBar({
  caseId,
  status,
  priority,
  assigneeId,
  category,
  dueAt,
  staff,
  followers,
  following,
}: {
  caseId: string;
  status: CaseStatusKey;
  priority: Priority;
  assigneeId: string | null;
  category: string;
  dueAt: string | null;
  staff: { id: string; name: string }[];
  followers: string[];
  following: boolean;
}) {
  const t = useTranslations('platform.case');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [due, setDue] = useState(toLocalInput(dueAt));
  const patch = (p: Parameters<typeof updateCaseAction>[1]) =>
    start(async () => {
      const res = await updateCaseAction(caseId, p);
      if (!res.ok) toast.error({ title: t('errors.generic'), closeLabel: tc('close') });
      router.refresh();
    });
  const field = (label: string, control: React.ReactNode) => (
    <label className="flex items-center gap-2 text-meta text-fg-2">
      {label}
      {control}
    </label>
  );
  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md bg-surface px-5 py-3 shadow-sm"
      aria-busy={pending}
    >
      {field(
        t('statusLabel'),
        <Select
          aria-label={t('statusLabel')}
          value={status}
          onValueChange={(v) => patch({ status: v })}
          options={(['new', 'in_progress', 'waiting', 'resolved', 'closed'] as CaseStatusKey[]).map(
            (s) => ({
              value: s,
              label: t(`status.${s}`),
            }),
          )}
        />,
      )}
      {field(
        t('priorityLabel'),
        <Select
          aria-label={t('priorityLabel')}
          value={priority}
          onValueChange={(v) => patch({ priority: v })}
          options={(['critical', 'high', 'normal', 'low'] as Priority[]).map((p) => ({
            value: p,
            label: t(`priority.${p}`),
          }))}
        />,
      )}
      {field(
        t('assignee'),
        <Select
          aria-label={t('assignee')}
          value={assigneeId ?? 'none'}
          onValueChange={(v) => patch({ assigneeId: v === 'none' ? null : v })}
          options={[
            { value: 'none', label: t('unassigned') },
            ...staff.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />,
      )}
      {field(
        t('categoryLabel'),
        <Select
          aria-label={t('categoryLabel')}
          value={category}
          onValueChange={(v) => patch({ category: v })}
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
            label: t(`category.${k}`),
          }))}
        />,
      )}
      <label className="flex items-center gap-2 text-meta text-fg-2">
        <Icon icon={Clock} size={14} />
        {t('due')}
        <input
          type="datetime-local"
          aria-label={t('due')}
          value={due}
          onChange={(e) => setDue(e.target.value)}
          onBlur={() => patch({ dueAt: due ? new Date(due).toISOString() : null })}
          className="h-9 rounded-sm border-0 bg-bg-base px-2 font-sans text-table text-fg-1 shadow-ring-chip"
        />
        {dueAt && (
          <span className="text-fg-1">{formatRelative(new Date(dueAt), new Date(), locale)}</span>
        )}
      </label>
      <span className="ml-auto flex items-center gap-2 text-meta text-fg-2">
        {t('followers')}
        {followers.map((f) => (
          <span key={f} title={f}>
            <Avatar name={f} size={28} tone="navy" />
          </span>
        ))}
        <Button
          variant="ghost"
          size="icon"
          aria-label={following ? t('unfollow') : t('follow')}
          onClick={() =>
            start(async () => {
              await followCaseAction(caseId, !following);
              router.refresh();
            })
          }
        >
          <Icon icon={following ? BellOff : BellRing} size={16} />
        </Button>
      </span>
    </div>
  );
}
