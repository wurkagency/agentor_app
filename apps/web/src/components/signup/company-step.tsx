'use client';

import { Banner } from '@agentor/ui';
import {
  ChoiceChips,
  CvrField,
  LogoImg,
  MobileSignupShell,
  SignupButton,
  SignupHeading,
  SignupInput,
  SignupShell,
  SystemPicker,
  TrustPanel,
  type CvrState,
  type SystemOption,
} from '@agentor/ui/signup';
import { CVR_ERROR_CODES, parseCvr, type CvrProblem } from '@agentor/core';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { lookupSignupCvr, saveSignupCompany } from '@/app/(signup)/actions';

export interface CompanyInitial {
  cvr: string;
  name: string;
  addressLine: string;
  postalCode: string;
  city: string;
  ordersPerMonth: 'lt100' | '100-1000' | 'gt1000' | null;
  chosenConnectors: string[];
}

export interface SystemInfo extends SystemOption {
  category: string;
}

/**
 * SU3 / MS3: CVR lookup ("Fundet"), the systems in use and orders per month. A failed lookup
 * never blocks: name and address can be typed in. The panel on desktop shows how the chosen
 * systems fit together, from the catalogue's categories.
 */
export function CompanyStep({
  mobile = false,
  initial,
  featured,
  all,
  topRight,
  step,
  points,
}: {
  mobile?: boolean;
  initial: CompanyInitial;
  featured: SystemInfo[];
  all: SystemInfo[];
  topRight: ReactNode;
  step: ReactNode;
  points: ReactNode;
}) {
  const t = useTranslations('signupFlow.company');
  const [cvr, setCvr] = useState(initial.cvr);
  const [cvrState, setCvrState] = useState<CvrState>(
    initial.name && initial.cvr
      ? { kind: 'found', name: initial.name, address: address(initial) }
      : { kind: 'idle' },
  );
  const [manual, setManual] = useState(!!initial.name && !initial.cvr);
  const [company, setCompany] = useState({
    name: initial.name,
    addressLine: initial.addressLine,
    postalCode: initial.postalCode,
    city: initial.city,
  });
  const [systems, setSystems] = useState(initial.chosenConnectors);
  const [orders, setOrders] = useState(initial.ordersPerMonth);
  const [showAll, setShowAll] = useState(
    initial.chosenConnectors.some((id) => !featured.some((f) => f.id === id)),
  );
  const [errors, setErrors] = useState<{
    cvr?: string | undefined;
    name?: string | undefined;
    form?: string | undefined;
  }>({});
  const [pending, start] = useTransition();

  const cvrError = (reason: CvrProblem) => t(`errors.${CVR_ERROR_CODES[reason]}`);

  const lookup = () => {
    const parsed = parseCvr(cvr);
    if (!parsed.ok) {
      setErrors((e) => ({ ...e, cvr: cvrError(parsed.reason) }));
      return;
    }
    const clean = parsed.cvr;
    setErrors((e) => ({ ...e, cvr: undefined }));
    setCvrState({ kind: 'searching' });
    start(async () => {
      const r = await lookupSignupCvr(clean);
      if (r.ok && r.data) {
        const c = r.data;
        if (!c.active) {
          setCvrState({ kind: 'notFound' });
          setErrors((e) => ({ ...e, cvr: t('ceased') }));
          setManual(true);
          return;
        }
        const next = {
          name: c.name,
          addressLine: c.addressLine ?? '',
          postalCode: c.postalCode ?? '',
          city: c.city ?? '',
        };
        setCompany(next);
        setManual(false);
        setCvrState({ kind: 'found', name: c.name, address: address(next), industry: c.industry });
      } else {
        // Not found or the register is down: type it in, signup goes on (prompt §3).
        setCvrState({ kind: r.ok || r.error === 'cvrNotFound' ? 'notFound' : 'unavailable' });
        if (!r.ok && ['cvrFormat', 'cvrChecksum', 'cvrForeign'].includes(r.error))
          setErrors((e) => ({ ...e, cvr: t(`errors.${r.error}` as 'errors.cvrFormat') }));
        setManual(true);
      }
    });
  };

  const submit = () => {
    const name = company.name.trim();
    if (name.length < 2) {
      setManual(true);
      setErrors({ name: t('errors.name') });
      return;
    }
    // A typed CVR is either valid or an error to fix; it is never dropped without a word.
    const typed = cvr.trim() ? parseCvr(cvr) : null;
    if (typed && !typed.ok) {
      setErrors({ cvr: cvrError(typed.reason) });
      return;
    }
    setErrors({});
    start(async () => {
      const r = await saveSignupCompany({
        name,
        cvr: typed?.ok ? typed.cvr : '',
        addressLine: company.addressLine,
        postalCode: company.postalCode,
        city: company.city,
        ordersPerMonth: orders,
        chosenConnectors: systems,
      });
      if (r && !r.ok) {
        if (['cvrFormat', 'cvrChecksum', 'cvrForeign'].includes(r.error)) {
          setErrors({ cvr: t(`errors.${r.error}` as 'errors.cvrFormat') });
          return;
        }
        const key = ['SIGNUP_PENDING', 'TENANT_LIMIT'].includes(r.error) ? r.error : 'generic';
        setErrors({ form: t(`errors.${key}` as 'errors.generic') });
      }
    });
  };

  const options = showAll ? all : featured;
  const form = (
    <>
      <SignupHeading
        mobile={mobile}
        title={t('title')}
        lead={mobile ? t('leadMobile') : t('lead')}
      />
      {errors.form && <Banner tone="error">{errors.form}</Banner>}
      <CvrField
        mobile={mobile}
        label={t('cvr')}
        value={cvr}
        onChange={(v) => {
          setCvr(v);
          if (cvrState.kind !== 'idle' && cvrState.kind !== 'searching')
            setCvrState({ kind: 'idle' });
        }}
        onLookup={lookup}
        state={cvrState}
        error={errors.cvr}
        texts={{
          found: t('found'),
          searching: t('searching'),
          lookup: t('lookup'),
          notFound: t('notFound'),
          unavailable: t('unavailable'),
        }}
      />
      {manual && (
        <div className="flex flex-col gap-3">
          <SignupInput
            mobile={mobile}
            label={t('name')}
            autoComplete="organization"
            value={company.name}
            onChange={(e) => setCompany((c) => ({ ...c, name: e.target.value }))}
            error={errors.name}
          />
          <SignupInput
            mobile={mobile}
            label={t('address')}
            autoComplete="street-address"
            value={company.addressLine}
            onChange={(e) => setCompany((c) => ({ ...c, addressLine: e.target.value }))}
          />
          <div className="grid grid-cols-postal gap-3">
            <SignupInput
              mobile={mobile}
              label={t('postalCode')}
              autoComplete="postal-code"
              inputMode="numeric"
              value={company.postalCode}
              onChange={(e) => setCompany((c) => ({ ...c, postalCode: e.target.value }))}
            />
            <SignupInput
              mobile={mobile}
              label={t('city')}
              autoComplete="address-level2"
              value={company.city}
              onChange={(e) => setCompany((c) => ({ ...c, city: e.target.value }))}
            />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        <SystemPicker
          mobile={mobile}
          label={t('systems')}
          options={options}
          value={systems}
          onChange={setSystems}
          soonLabel={t('soon')}
        />
        {!mobile && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            aria-expanded={showAll}
            className="self-start cursor-pointer border-0 bg-transparent p-0 font-sans text-meta font-semibold text-fg-1 underline"
          >
            {showAll ? t('showFewer') : t('seeAll', { count: all.length })}
          </button>
        )}
      </div>
      <ChoiceChips
        mobile={mobile}
        label={t('orders')}
        value={orders}
        onChange={(v) => setOrders(v as CompanyInitial['ordersPerMonth'])}
        options={[
          { value: 'lt100', label: t('lt100') },
          { value: '100-1000', label: t('mid') },
          { value: 'gt1000', label: t('gt1000') },
        ]}
      />
      {/* SU3's "Tilbage" led to SU2, which can't be reopened once the e-mail is confirmed
          (PLAN-SIGNUP §10), so this step has only "Fortsæt". */}
      <div className={mobile ? 'mt-auto flex gap-2.5' : 'flex gap-2.5'}>
        <SignupButton mobile={mobile} grow loading={pending} onClick={submit}>
          {pending ? t('saving') : t('continue')}
        </SignupButton>
      </div>
    </>
  );

  if (mobile)
    return (
      <MobileSignupShell topRight={topRight} step={step}>
        {form}
      </MobileSignupShell>
    );
  return (
    <SignupShell
      topRight={topRight}
      step={step}
      panel={
        <FitPanel
          systems={systems
            .map((id) => all.find((s) => s.id === id))
            .filter((s): s is SystemInfo => !!s)}
          points={points}
        />
      }
    >
      {form}
    </SignupShell>
  );
}

function address(c: { addressLine: string; postalCode: string; city: string }) {
  return [c.addressLine, [c.postalCode, c.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
}

/** SU3's panel: "WooCommerce, Dinero og HubSpot passer sammen" with the chosen systems. */
function FitPanel({ systems, points }: { systems: SystemInfo[]; points: ReactNode }) {
  const t = useTranslations('signupFlow.company');
  const source = systems.find((s) => s.category === 'webshop');
  const erp = systems.find((s) => s.category === 'erp');
  const crm = systems.find((s) => s.category === 'crm');
  const destinations = useMemo(
    () => systems.filter((s) => s !== source && s.category !== 'webshop').slice(0, 3),
    [systems, source],
  );
  const names = [source, ...destinations].filter((s): s is SystemInfo => !!s).map((s) => s.name);
  const joined =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} ${t('and')} ${names.at(-1)}`
      : (names[0] ?? '');
  const ready = !!source && destinations.length > 0;
  const lead = !ready
    ? t('panelEmptyLead')
    : erp && crm
      ? t('panelLeadErpCrm', { erp: erp.name, crm: crm.name })
      : erp
        ? t('panelLeadErp', { erp: erp.name })
        : t('panelLeadOther');
  return (
    <TrustPanel
      label={ready ? t('panelTitle', { systems: joined }) : t('panelEmptyTitle')}
      title={ready ? t('panelTitle', { systems: joined }) : t('panelEmptyTitle')}
      lead={lead}
      points={points}
    >
      {ready && (
        <div className="flex items-center gap-4.5" aria-hidden>
          <span className="grid size-18 flex-none place-items-center rounded-bubble bg-white shadow-tile">
            <LogoImg logo={source} size="lg" />
          </span>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {destinations.map((d) => (
              <li key={d.id} className="flex items-center gap-2.5">
                <span className="h-0.5 w-16 bg-primary" />
                <span className="grid size-14 flex-none place-items-center rounded-bubble bg-white shadow-tile">
                  <LogoImg logo={d} size="md" />
                </span>
                <span className="text-table text-on-navy-muted">
                  {t(`carries.${d.category}` as 'carries.erp')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </TrustPanel>
  );
}
