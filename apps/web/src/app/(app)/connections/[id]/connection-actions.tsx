'use client';

import type { AuthField } from '@agentor/connectors';
import {
  Banner,
  Button,
  Card,
  CardHeader,
  CopyButton,
  DestructiveDialog,
  Dialog,
  Field,
  Icon,
  Input,
  toast,
} from '@agentor/ui';
import { Unplug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LinkTabs } from '@/components/link-tabs';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { disconnect, newWebhookAddress, reconnectWithKey, testConnection } from '../actions';

export function ConnectionActions({
  id,
  name,
  usedInFlows,
}: {
  id: string;
  name: string;
  usedInFlows: number;
}) {
  const t = useTranslations('connections');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);

  const test = () =>
    start(async () => {
      const res = await testConnection(id);
      if (res.ok) {
        toast.info({ title: t('testStarted'), closeLabel: tc('close') });
        router.refresh();
      } else toast.error({ title: t('errors.generic'), closeLabel: tc('close') });
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="m" onClick={test} loading={pending && !confirm}>
        {t('test')}
      </Button>
      <Button variant="destructive" size="m" onClick={() => setConfirm(true)}>
        {t('disconnect')}
      </Button>
      <DestructiveDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('disconnectTitle', { name })}
        consequences={[
          usedInFlows ? t('disconnectFlows', { count: usedInFlows }) : t('disconnectNoFlows'),
          t('disconnectKeys'),
          t('disconnectHistory'),
        ]}
        confirmName={name}
        confirmLabel={t('disconnect')}
        typeLabel={t('disconnectType')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        busy={pending}
        onConfirm={() =>
          start(async () => {
            const res = await disconnect(id);
            if (res.ok) {
              toast.ok({ title: t('disconnected', { name }), closeLabel: tc('close') });
              router.push('/connections');
            } else toast.error({ title: t('errors.generic'), closeLabel: tc('close') });
          })
        }
      />
    </div>
  );
}

export function BrokenBanner({
  connectionId,
  connectorId,
  oauth,
  canManage,
  openReconnect,
  fields,
  title,
  body,
}: {
  connectionId: string;
  connectorId: string;
  oauth: boolean;
  canManage: boolean;
  openReconnect: boolean;
  fields: AuthField[];
  title: string;
  body: string;
}) {
  const t = useTranslations('connections');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(openReconnect && !oauth);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  const reconnect = () => {
    if (oauth) router.push(`/connect/${connectorId}?reconnect=${connectionId}`);
    else setOpen(true);
  };

  return (
    <>
      <Banner
        tone="error"
        title={title}
        action={
          canManage ? (
            <Button variant="dark" size="m" onClick={reconnect}>
              {t('reconnect')}
            </Button>
          ) : undefined
        }
      >
        {body}
      </Banner>
      {!oauth && (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={t('reconnect')}
          description={t('reconnectIntro')}
          width={560}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="secondary" size="m" onClick={() => setOpen(false)}>
                {tc('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    setError(false);
                    const res = await reconnectWithKey(connectionId, connectorId, values);
                    if (res.ok) {
                      setOpen(false);
                      router.replace(`/connections/${connectionId}`);
                      router.refresh();
                    } else setError(true);
                  })
                }
              >
                {t('save')}
              </Button>
            </>
          }
        >
          {error && <Banner tone="error">{t('errors.generic')}</Banner>}
          {fields.map((f) => (
            <Field key={f.key} label={f.label} help={f.help}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type={f.type === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  aria-describedby={describedBy}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </Dialog>
      )}
    </>
  );
}

export function ConnectionTabs({
  active,
  showHistory,
}: {
  active: 'overview' | 'history';
  showHistory: boolean;
}) {
  const t = useTranslations('connections');
  const pathname = usePathname();
  return (
    <LinkTabs
      label={t('tabsLabel')}
      active={active}
      items={[
        { key: 'overview', href: pathname, label: t('overview') },
        ...(showHistory
          ? [{ key: 'history', href: `${pathname}?tab=history`, label: t('historyTab') }]
          : []),
      ]}
    />
  );
}

/** Webhook address: shown once on creation; here only a new one can be made. */
export function WebhookAddress({
  connectionId,
  lastWebhook,
}: {
  connectionId: string;
  lastWebhook: string | null;
}) {
  const t = useTranslations('connections');
  const tc = useTranslations('common');
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader
        title={t('webhook')}
        meta={lastWebhook ? t('webhookReceived', { when: lastWebhook }) : t('noWebhookYet')}
      />
      {url ? (
        <Field label={t('webhookUrl')} help={t('webhookHelp')}>
          {({ id, describedBy }) => (
            <div className="flex items-center gap-2">
              <Input id={id} readOnly mono value={url} aria-describedby={describedBy} />
              <CopyButton value={url} label={tc('copy')} copiedLabel={tc('copied')} />
            </div>
          )}
        </Field>
      ) : (
        <div>
          <Button
            variant="secondary"
            size="s"
            loading={pending}
            onClick={() =>
              start(async () => {
                const res = await newWebhookAddress(connectionId);
                if (res.ok && res.data) setUrl(res.data.webhookUrl);
              })
            }
          >
            <Icon icon={Unplug} size={14} />
            {t('newWebhook')}
          </Button>
          <p className="m-0 mt-2 text-meta text-fg-2">{t('newWebhookNote')}</p>
        </div>
      )}
    </Card>
  );
}
