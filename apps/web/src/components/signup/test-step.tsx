'use client';

import { formatMoney } from '@agentor/i18n';
import { Banner, Button, Dialog, Select } from '@agentor/ui';
import {
  MobileSignupShell,
  SignupButton,
  SignupHeading,
  SignupShell,
  Spinner,
  TestRunCounters,
  TestRunList,
  TestRunTable,
  TrustPanel,
  type TestRunRowView,
} from '@agentor/ui/signup';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import {
  chooseOnboardingAccount,
  goLiveOnboarding,
  onboardingTestRun,
  rerunOnboardingTest,
  type TestRow,
} from '@/app/(signup)/onboarding/actions';

const SHOWN = 4;

/**
 * OB4 / MO4: the test run on the 10 latest orders. Nothing is written to the accounting system;
 * this shows what would be sent. A missing account (EU-salg) is chosen right in the row, which
 * runs the test again. "Gå live som kladde" publishes the flow (decision 11).
 */
export function TestStep({
  mobile = false,
  initialRun,
  erpName,
  invoiceMode,
  accounts,
  topRight,
  step,
  diagram,
  points,
}: {
  mobile?: boolean;
  initialRun: string | null;
  erpName: string;
  invoiceMode: 'draft' | 'live';
  accounts: { value: string; label: string }[];
  topRight: ReactNode;
  step: ReactNode;
  diagram?: ReactNode;
  points?: ReactNode;
}) {
  const t = useTranslations('onboardingFlow.test');
  const locale = useLocale() as 'da' | 'en';
  const [runId, setRunId] = useState(initialRun);
  const [rows, setRows] = useState<TestRow[] | null>(null);
  const [status, setStatus] = useState<string>('queued');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (runId) return;
    start(async () => {
      const r = await rerunOnboardingTest();
      if (r.ok && r.data) setRunId(r.data.runId);
      else setError(t('failed'));
    });
  }, [runId, t]);

  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      const r = await onboardingTestRun(runId).catch(() => null);
      if (stop) return;
      if (r?.ok && r.data) {
        setStatus(r.data.status);
        if (r.data.status !== 'queued' && r.data.status !== 'running') {
          setRows(r.data.rows);
          return;
        }
      }
      setTimeout(tick, 1500);
    };
    setRows(null);
    void tick();
    return () => {
      stop = true;
    };
  }, [runId]);

  const choose = (key: string, value: string) =>
    start(async () => {
      setError(null);
      const r = await chooseOnboardingAccount({ key, value });
      if (r.ok && r.data) setRunId(r.data.runId);
      else setError(t('errorsList.generic'));
    });

  const needs = rows?.filter((r) => r.outcome === 'needsAccount') ?? [];
  const failed = rows?.filter((r) => r.outcome === 'failed') ?? [];
  const ready = rows?.filter((r) => r.outcome === 'ready') ?? [];

  const goLive = () =>
    start(async () => {
      setError(null);
      if (needs.length) {
        setError(t('goLiveBlocked'));
        return;
      }
      const r = await goLiveOnboarding();
      if (r && !r.ok)
        setError(t(r.error === 'VALIDATION' ? 'errorsList.VALIDATION' : 'errorsList.generic'));
    });

  const view = (r: TestRow): TestRunRowView => ({
    id: r.id,
    order: r.order,
    customer: r.customer,
    amount: r.amount === null ? '–' : formatMoney(r.amount, locale),
    account: r.account,
    state: r.outcome,
    note:
      r.outcome === 'needsAccount'
        ? r.saleKind === 'euB2b'
          ? mobile
            ? t('euB2bShort')
            : t('euB2b')
          : t('missingAccount')
        : undefined,
    action:
      r.outcome === 'needsAccount' && r.missingKey ? (
        <Select
          aria-label={t('chooseFor')}
          placeholder={t('chooseAccount')}
          disabled={pending}
          density={mobile ? 'compact' : 'table'}
          onValueChange={(v) => choose(r.missingKey!, v)}
          options={accounts.map((a) => ({ value: a.value, label: `${a.value} ${a.label}` }))}
        />
      ) : undefined,
  });
  // Problems first, then the first ready ones, the rest as "+ N ordrer klar".
  const ordered = [...needs, ...failed, ...ready];
  const shown = ordered.slice(0, Math.max(SHOWN, needs.length + failed.length));
  const more = ordered.length - shown.length;
  const stateLabel = {
    ready: t('state.ready'),
    needsAccount: t('state.needsAccount'),
    failed: t('state.failed'),
  };

  const results =
    rows === null ? (
      <p className="m-0 flex items-center gap-2 text-body text-fg-2" role="status">
        <Spinner />
        {t('running')}
      </p>
    ) : rows.length === 0 ? (
      <Banner tone="info">{status === 'failed' ? t('failed') : t('empty')}</Banner>
    ) : (
      <>
        <TestRunCounters
          mobile={mobile}
          items={[
            {
              label: mobile ? t('readyShort') : t('ready', { erp: erpName }),
              value: ready.length,
              detail: invoiceMode === 'live' ? t('readyLive') : t('readyDraft'),
              tone: 'ok',
            },
            {
              label: mobile ? t('needsShort') : t('needs'),
              value: needs.length,
              detail: needs.length ? t('needsDetail', { count: needs.length }) : t('needsNone'),
              tone: 'warn',
            },
            {
              label: t('errors'),
              value: failed.length,
              detail: failed.length ? t('errorsDetail', { count: failed.length }) : t('errorsNone'),
              tone: 'error',
            },
          ]}
        />
        {mobile ? (
          <TestRunList
            label={t('tableCaption')}
            rows={shown.map(view)}
            more={more > 0 ? t('more', { count: more }) : undefined}
            stateLabel={stateLabel}
          />
        ) : (
          <TestRunTable
            caption={t('tableCaption')}
            head={{
              order: t('head.order'),
              customer: t('head.customer'),
              amount: t('head.amount'),
              account: t('head.account'),
              result: t('head.result'),
            }}
            rows={shown.map(view)}
            more={more > 0 ? t('more', { count: more }) : undefined}
            stateLabel={stateLabel}
          />
        )}
      </>
    );

  const body = (
    <>
      <SignupHeading
        mobile={mobile}
        title={mobile ? t('titleMobile') : t('title')}
        lead={t('lead', { erp: erpName })}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {results}
      <div className={mobile ? 'mt-auto flex gap-2.5' : 'flex gap-2.5'}>
        <SignupButton
          asChild
          variant="secondary"
          mobile={mobile}
          className={mobile ? 'px-5.5' : ''}
        >
          <Link href="/onboarding/template">{t('back')}</Link>
        </SignupButton>
        <SignupButton
          mobile={mobile}
          grow
          loading={pending && rows !== null}
          disabled={rows === null}
          onClick={() => (invoiceMode === 'live' ? setConfirm(true) : goLive())}
        >
          {pending && rows !== null
            ? t('publishing')
            : invoiceMode === 'live'
              ? t('goLive')
              : t('goLiveDraft')}
        </SignupButton>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('confirmLiveTitle')}
        closeLabel={t('cancel')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirm(false);
                goLive();
              }}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p className="m-0 text-body">{t('confirmLive', { erp: erpName })}</p>
      </Dialog>
    </>
  );
  if (mobile)
    return (
      <MobileSignupShell topRight={topRight} step={step}>
        {body}
      </MobileSignupShell>
    );
  return (
    <SignupShell
      wide
      alignTop
      topRight={topRight}
      step={step}
      panel={
        <TrustPanel
          label={t('panelTitle')}
          title={t('panelTitle')}
          lead={t('panelLead')}
          points={points}
        >
          {diagram}
        </TrustPanel>
      }
    >
      {body}
    </SignupShell>
  );
}
