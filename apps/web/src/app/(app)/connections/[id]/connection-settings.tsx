'use client';

import type { SettingField, SettingValue } from '@agentor/connectors';
import { Advanced, Button, Card, CardHeader, Field, toast } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  SettingControl,
  visibleSettings,
  type LookupMap,
} from '@/components/editor/setting-control';
import { saveConnectionSettings } from '../actions';

/**
 * The connection's own settings (PLAN-INTEGRATIONS §3.1 L1), generated from the manifest: which
 * WooCommerce field holds the VAT number, which Dinero company to book in. Shared by every flow
 * that uses the connection.
 */
export function ConnectionSettings({
  connectionId,
  fields,
  values,
  lookups,
  canManage,
}: {
  connectionId: string;
  fields: SettingField[];
  values: Record<string, unknown>;
  lookups: LookupMap;
  canManage: boolean;
}) {
  const t = useTranslations('connections.settings');
  const tc = useTranslations('common');
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, unknown>>(values);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(values);
  const { basic, advanced } = visibleSettings(fields, draft);
  const control = (f: SettingField) => (
    <Field key={f.key} label={f.label} help={f.help} inline>
      {({ id, describedBy }) => (
        <SettingControl
          field={f}
          value={draft[f.key]}
          onChange={(v: SettingValue) => setDraft((d) => ({ ...d, [f.key]: v }))}
          lookups={lookups}
          readOnly={!canManage || pending}
          id={id}
          describedBy={describedBy}
          noneLabel={t('none')}
        />
      )}
    </Field>
  );
  const save = () =>
    start(async () => {
      const res = await saveConnectionSettings(connectionId, draft);
      if (res.ok) {
        toast.ok({ title: t('saved'), closeLabel: tc('close') });
        router.refresh();
      } else toast.error({ title: t('notSaved'), closeLabel: tc('close') });
    });
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader title={t('title')} meta={t('shared')} />
      {basic.map(control)}
      {advanced.length > 0 && <Advanced label={t('advanced')}>{advanced.map(control)}</Advanced>}
      {canManage && (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="s"
            disabled={!dirty || pending}
            onClick={() => setDraft(values)}
          >
            {tc('cancel')}
          </Button>
          <Button size="s" disabled={!dirty} loading={pending} onClick={save}>
            {tc('save')}
          </Button>
        </div>
      )}
    </Card>
  );
}
