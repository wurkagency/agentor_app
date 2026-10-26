'use client';

import { Banner, Button, Dialog, Icon } from '@agentor/ui';
import {
  MobileSignupShell,
  OrderSummary,
  SignupButton,
  SignupHeading,
  SignupShell,
  TermsAcceptance,
  TrustPanel,
  type OrderSummaryProps,
} from '@agentor/ui/signup';
import { CheckCircle2, CreditCard, LoaderCircle, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { signupPaymentStatus, startSignupPayment } from '@/app/(signup)/actions';

type Doc = 'subscriptionTerms' | 'privacy';

const POLL_MS = 2000;
const POLL_MAX_MS = 120_000;

/**
 * SU5 / MS5: order summary, "Accept af betingelser" and the pay button, which takes the owner to
 * QuickPay's payment window (B3). Card details are typed there, never here. After the return the
 * page waits for QuickPay's verified callback; the return itself never activates anything.
 */
export function PaymentStep({
  mobile = false,
  order,
  pay,
  docs,
  initialStatus,
  topRight,
  step,
  points,
  panelPoints,
}: {
  mobile?: boolean;
  order: OrderSummaryProps;
  /** "1.987,50 kr." */
  pay: string;
  docs: Record<Doc, string | null>;
  initialStatus: 'idle' | 'waiting' | 'failed' | 'cancelled';
  topRight: ReactNode;
  step: ReactNode;
  points?: ReactNode;
  panelPoints?: string[];
}) {
  const t = useTranslations('signupFlow.payment');
  const router = useRouter();
  const [accepted, setAccepted] = useState<Record<Doc, boolean>>({
    subscriptionTerms: false,
    privacy: false,
  });
  const [status, setStatus] = useState(initialStatus);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  const [pending, start] = useTransition();
  const both = accepted.subscriptionTerms && accepted.privacy;

  // Back from QuickPay: ask every 2 s until the callback has activated the company.
  useEffect(() => {
    if (status !== 'waiting') return;
    const started = Date.now();
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const r = await signupPaymentStatus().catch(() => null);
      if (r?.ok && r.data) {
        if (r.data.status === 'active') {
          router.replace('/signup/welcome');
          return;
        }
        if (r.data.status === 'failed') {
          setStatus('failed');
          return;
        }
      }
      if (Date.now() - started > POLL_MAX_MS) setSlow(true);
      setTimeout(tick, POLL_MS);
    };
    const id = setTimeout(tick, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(id);
    };
  }, [status, router]);

  const submit = () => {
    if (!both) {
      setTermsError(t('errors.termsRequired'));
      return;
    }
    setTermsError(null);
    setError(null);
    start(async () => {
      const r = await startSignupPayment({ acceptSubscriptionTerms: true, acceptPrivacy: true });
      if (r.ok && r.data) window.location.assign(r.data.url);
      else if (!r.ok) {
        const known = [
          'termsRequired',
          'termsUnavailable',
          'rateLimited',
          'NOT_OWNER',
          'NOT_PENDING',
        ];
        setError(t(`errors.${known.includes(r.error) ? r.error : 'generic'}` as 'errors.generic'));
      }
    });
  };

  const notice =
    status === 'waiting' ? (
      <Banner tone="info" icon={LoaderCircle}>
        {slow ? t('slow') : t('waiting')}
      </Banner>
    ) : status === 'failed' ? (
      <Banner tone="error">{t('failed')}</Banner>
    ) : status === 'cancelled' ? (
      <Banner tone="warn">{t('cancelled')}</Banner>
    ) : null;

  const card = (
    <div
      className={
        mobile
          ? 'flex flex-col gap-2.5 rounded-md bg-surface p-3.5 shadow-sm'
          : 'flex flex-col gap-3 rounded-md bg-surface p-4.5 shadow-sm'
      }
    >
      <span className="flex items-center gap-2.5 text-body font-semibold">
        <Icon icon={CreditCard} size={18} />
        {t('card')}
      </span>
      <p className="m-0 text-body text-fg-2">{t('cardInfo')}</p>
      <span className="flex items-center gap-1.5 text-meta font-medium text-fg-2">
        <Icon icon={Lock} size={14} />
        {t('secure')}
      </span>
    </div>
  );

  const terms = (
    <TermsAcceptance
      mobile={mobile}
      legend={t('terms')}
      requiredLabel={t('required')}
      error={termsError ?? undefined}
      items={[
        {
          id: 'subscriptionTerms',
          lead: t('accept'),
          link: t('subscriptionTerms'),
          onOpen: () => setOpen('subscriptionTerms'),
          checked: accepted.subscriptionTerms,
          onChange: (v) => {
            setAccepted((a) => ({ ...a, subscriptionTerms: v }));
            setTermsError(null);
          },
        },
        {
          id: 'privacy',
          lead: t('read'),
          link: t('privacy'),
          onOpen: () => setOpen('privacy'),
          checked: accepted.privacy,
          onChange: (v) => {
            setAccepted((a) => ({ ...a, privacy: v }));
            setTermsError(null);
          },
        },
      ]}
    />
  );

  const payButton = (
    <SignupButton
      mobile={mobile}
      grow={!mobile}
      loading={pending}
      disabled={!both || status === 'waiting'}
      aria-disabled={!both || undefined}
      onClick={submit}
      icon={<Icon icon={Lock} size={16} />}
      className={mobile ? 'mt-auto w-full' : ''}
    >
      {pending ? t('paying') : status === 'failed' ? t('retry') : t('pay', { amount: pay })}
    </SignupButton>
  );

  const docName = open === 'privacy' ? t('privacy') : t('subscriptionTerms');
  const modal = (
    <Dialog
      open={open !== null}
      onOpenChange={(o) => !o && setOpen(null)}
      title={docName}
      width={720}
      closeLabel={t('close')}
      footer={
        <Button variant="secondary" onClick={() => setOpen(null)}>
          {t('close')}
        </Button>
      }
    >
      {open && docs[open] ? (
        // Served from agentor.dk (B6); sandboxed, no scripts from our origin.
        <iframe
          title={docName}
          src={docs[open]!}
          sandbox=""
          className="h-dialog-doc w-full rounded-sm border border-border"
        />
      ) : (
        <p className="m-0 text-body text-fg-2">{t('documentPlaceholder', { name: docName })}</p>
      )}
    </Dialog>
  );

  const body = (
    <>
      <SignupHeading
        mobile={mobile}
        title={t('title')}
        lead={mobile ? t('leadMobile') : t('lead')}
      />
      {notice}
      {error && <Banner tone="error">{error}</Banner>}
      {mobile && <OrderSummary {...order} mobile />}
      {card}
      {terms}
      {mobile ? (
        payButton
      ) : (
        <div className="flex gap-2.5">
          <SignupButton asChild variant="secondary">
            <Link href="/signup/plan">{t('back')}</Link>
          </SignupButton>
          {payButton}
        </div>
      )}
      {modal}
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
      topRight={topRight}
      step={step}
      panel={
        <TrustPanel label={t('order')} title={t('order')} points={points}>
          <OrderSummary {...order} />
          {panelPoints && (
            <ul className="m-0 flex max-w-signup-panel list-none flex-col gap-2.5 p-0">
              {panelPoints.map((p) => (
                <li key={p} className="flex items-center gap-2.5 text-body">
                  <Icon icon={CheckCircle2} size={18} className="text-primary" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </TrustPanel>
      }
    >
      {body}
    </SignupShell>
  );
}
