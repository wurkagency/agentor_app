'use client';

import { Banner, Button, Field, Icon, Input, Select, Textarea, toast } from '@agentor/ui';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { openCaseAction, replyAction } from '@/app/(app)/support/actions';

/** Kontakt support: what's wrong, in your own words, optionally on a flow. */
export function NewCaseForm({ flows }: { flows: { id: string; name: string }[] }) {
  const t = useTranslations('support');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [flowId, setFlowId] = useState('none');
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex max-w-form flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await openCaseAction({
            title,
            body,
            flowId: flowId === 'none' ? null : flowId,
          });
          if (res && !res.ok) setError(true);
        });
      }}
    >
      {error && <Banner tone="error">{t('error')}</Banner>}
      <Field label={t('subject')}>
        {({ id }) => (
          <Input
            id={id}
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('message')} help={t('messageHelp')}>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            required
            rows={6}
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('flow')} inline>
        {({ id }) => (
          <Select
            id={id}
            value={flowId}
            onValueChange={setFlowId}
            options={[
              { value: 'none', label: t('noFlow') },
              ...flows.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
        )}
      </Field>
      <p className="m-0 text-meta text-fg-2">{t('privacy')}</p>
      <div>
        <Button
          type="submit"
          variant="primary"
          size="l"
          loading={pending}
          disabled={!title.trim() || !body.trim()}
        >
          {!pending && <Icon icon={Send} size={16} />}
          {t('send')}
        </Button>
      </div>
    </form>
  );
}

export function ReplyForm({ caseId }: { caseId: string }) {
  const t = useTranslations('support');
  const tc = useTranslations('common');
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Textarea
        aria-label={t('reply')}
        rows={4}
        value={body}
        placeholder={t('replyPlaceholder')}
        onChange={(e) => setBody(e.target.value)}
      />
      <div>
        <Button
          variant="primary"
          size="m"
          loading={pending}
          disabled={!body.trim()}
          onClick={() =>
            start(async () => {
              const res = await replyAction(caseId, body);
              if (!res.ok) return void toast.error({ title: t('error'), closeLabel: tc('close') });
              setBody('');
              router.refresh();
            })
          }
        >
          {t('sendReply')}
        </Button>
      </div>
    </div>
  );
}
