'use client';

import type { PrefMatrix } from '@agentor/db';
import {
  Banner,
  Card,
  Checkbox,
  Field,
  Icon,
  Input,
  Switch,
  Table,
  Td,
  Th,
  Tr,
  toast,
} from '@agentor/ui';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { FormFooter } from '@/components/form-footer';
import { saveNotifications } from './actions';

const EVENTS = [
  'connection_broken',
  'systematic_error',
  'record_failed',
  'quota',
  'payment_failed',
  'connector_update',
  'weekly_summary',
] as const;
const CRITICAL = new Set<string>(['connection_broken', 'systematic_error']);
const CHANNELS = ['inApp', 'email', 'push', 'sms'] as const;
/** SMS only for critical events (produktspecifikation §7.8). */
const SMS_EVENTS = new Set<string>(['connection_broken', 'systematic_error', 'payment_failed']);

interface State {
  matrix: PrefMatrix;
  quiet: { enabled: boolean; start: string; end: string };
  smsPhone: string;
  thresholds: { errorRatePct: number; consecutiveFailures: number };
}

export function NotificationsForm({
  initial,
  canEditThresholds,
}: {
  initial: Omit<State, 'smsPhone'> & { smsPhone: string | null };
  canEditThresholds: boolean;
}) {
  const t = useTranslations('notifications');
  const common = useTranslations('common');
  const start: State = useMemo(() => ({ ...initial, smsPhone: initial.smsPhone ?? '' }), [initial]);
  const [state, setState] = useState<State>(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(state) !== JSON.stringify(start);

  const toggle = (event: (typeof EVENTS)[number], ch: (typeof CHANNELS)[number], v: boolean) =>
    setState((s) => ({ ...s, matrix: { ...s.matrix, [event]: { ...s.matrix[event], [ch]: v } } }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = await saveNotifications({
      ...state,
      thresholds: canEditThresholds ? state.thresholds : undefined,
    });
    setSaving(false);
    if (r.ok) toast.ok({ title: t('saved'), closeLabel: common('close') });
    else setError(r.error);
  };

  return (
    <form onSubmit={submit} noValidate>
      <Card padding="none">
        {error && (
          <div className="p-6 pb-0">
            <Banner tone="error">{t(`errors.${error}` as 'errors.phone')}</Banner>
          </div>
        )}
        <div className="grid grid-cols-1 gap-0 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Table>
              <thead>
                <tr>
                  <Th className="pl-6">{t('event')}</Th>
                  {CHANNELS.map((c) => (
                    <Th key={c} className="w-24 text-center">
                      {t(c)}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EVENTS.map((event) => (
                  <Tr key={event}>
                    <Td className="whitespace-normal py-3 pl-6">
                      <span className="block font-semibold">{t(`events.${event}`)}</span>
                      <span className="block text-meta font-medium text-fg-2">
                        {t(`events.${event}_help`, {
                          failures: state.thresholds.consecutiveFailures,
                          rate: state.thresholds.errorRatePct,
                        })}
                      </span>
                    </Td>
                    {CHANNELS.map((ch) => {
                      const locked = ch === 'inApp' && CRITICAL.has(event);
                      const unavailable = ch === 'sms' && !SMS_EVENTS.has(event);
                      const label = `${t(`events.${event}`)}: ${t(ch)}`;
                      return (
                        <Td key={ch} className="text-center">
                          {unavailable ? (
                            <span className="text-fg-3" aria-hidden>
                              –
                            </span>
                          ) : locked ? (
                            <span className="inline-flex opacity-55" title={t('locked')}>
                              <Checkbox checked disabled aria-label={`${label} (${t('locked')})`} />
                            </span>
                          ) : (
                            <Checkbox
                              checked={state.matrix[event][ch]}
                              onCheckedChange={(v) => toggle(event, ch, v === true)}
                              aria-label={label}
                            />
                          )}
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="m-0 flex items-center gap-1.5 px-6 py-4 text-meta font-medium text-fg-2">
              <Icon icon={Lock} size={14} />
              {t('criticalNote')}
            </p>
          </div>
          <div className="flex flex-col gap-6 p-6 shadow-hairline-l">
            <section className="flex flex-col gap-3">
              <h2 className="m-0 text-card">{t('thresholds')}</h2>
              <p className="m-0 text-meta font-medium text-fg-2">
                {canEditThresholds ? t('thresholdsNote') : t('thresholdsReadOnly')}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-table">
                <span>{t('systematicAt')}</span>
                <Input
                  aria-label={t('consecutive')}
                  type="number"
                  min={1}
                  max={100}
                  density="compact"
                  className="w-16"
                  disabled={!canEditThresholds}
                  value={state.thresholds.consecutiveFailures}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      thresholds: { ...s.thresholds, consecutiveFailures: Number(e.target.value) },
                    }))
                  }
                />
                <span>{t('consecutive')}</span>
                <span>{t('or')}</span>
                <Input
                  aria-label={t('rate')}
                  type="number"
                  min={1}
                  max={100}
                  density="compact"
                  className="w-16"
                  disabled={!canEditThresholds}
                  value={state.thresholds.errorRatePct}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      thresholds: { ...s.thresholds, errorRatePct: Number(e.target.value) },
                    }))
                  }
                />
                <span>{t('rate')}</span>
              </div>
            </section>
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="m-0 text-card">{t('quiet')}</h2>
                <Switch
                  aria-label={t('quiet')}
                  checked={state.quiet.enabled}
                  onCheckedChange={(v) =>
                    setState((s) => ({ ...s, quiet: { ...s.quiet, enabled: v } }))
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t('from')}
                  type="time"
                  density="compact"
                  className="w-28"
                  disabled={!state.quiet.enabled}
                  value={state.quiet.start}
                  onChange={(e) =>
                    setState((s) => ({ ...s, quiet: { ...s.quiet, start: e.target.value } }))
                  }
                />
                <span aria-hidden>–</span>
                <Input
                  aria-label={t('to')}
                  type="time"
                  density="compact"
                  className="w-28"
                  disabled={!state.quiet.enabled}
                  value={state.quiet.end}
                  onChange={(e) =>
                    setState((s) => ({ ...s, quiet: { ...s.quiet, end: e.target.value } }))
                  }
                />
              </div>
              <p className="m-0 text-meta text-fg-2">{t('quietNote')}</p>
            </section>
            <Field label={t('smsPhone')} help={t('smsPhoneHelp')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="tel"
                  autoComplete="tel"
                  placeholder="+45"
                  value={state.smsPhone}
                  onChange={(e) => setState((s) => ({ ...s, smsPhone: e.target.value }))}
                />
              )}
            </Field>
          </div>
        </div>
        <FormFooter dirty={dirty} saving={saving} onCancel={() => setState(start)} />
      </Card>
    </form>
  );
}
