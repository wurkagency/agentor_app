'use client';

import { Banner, Icon } from '@agentor/ui';
import {
  ConnectionDiagram,
  ConnectorTile,
  LogoImg,
  MobileSignupShell,
  NavyCard,
  PermissionList,
  SignupButton,
  SignupHeading,
  SignupInput,
  SignupShell,
  SuccessBanner,
  TrustPanel,
  type DiagramNode,
  type LogoRef,
} from '@agentor/ui/signup';
import { Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useTransition, type ReactNode } from 'react';
import {
  continueOnboarding,
  onboardingConnections,
  type OnboardingConnection,
} from '@/app/(signup)/onboarding/actions';

export interface ConnectOption extends LogoRef {
  id: string;
  /** No manifest yet ("På vej"): shown as on the boards, can't be connected (B5, T2). */
  soon: boolean;
  /** The system lives on the customer's own domain: ask for the address (WooCommerce). */
  needsUrl: boolean;
}

export interface ConnectStepProps {
  mobile?: boolean;
  step: 'webshop' | 'accounting';
  /** Systems in this category, the one chosen on SU3 first. */
  options: ConnectOption[];
  chosenId: string | null;
  /** All systems chosen on SU3 (for the diagram). */
  diagram: { source: ConnectOption | null; erp: ConnectOption | null; later: ConnectOption | null };
  initialConnections: OnboardingConnection[];
  /** Came back from the provider with ?connected=… */
  justConnected: boolean;
  connectError?: string | undefined;
  companyName: string;
  topRight: ReactNode;
  step_: ReactNode;
  points?: ReactNode;
  /** How many tiles before "Se alle". */
  featured: number;
}

/**
 * OB1/OB2 and MO1/MO2. Connecting opens the provider (or its stand-in, B4) through
 * /connect/[id]/start; back here the connection is tested by the worker, and the diagram turns
 * green when it works. On mobile the provider opens in the system browser; coming back to the app
 * the page checks again on focus.
 */
export function ConnectStep(p: ConnectStepProps) {
  const t = useTranslations('onboardingFlow');
  const tw = useTranslations('onboardingFlow.webshop');
  const ta = useTranslations('onboardingFlow.accounting');
  const ts = p.step === 'webshop' ? tw : ta;
  const mobile = !!p.mobile;
  const [selected, setSelected] = useState(
    p.chosenId ?? p.options.find((o) => !o.soon)?.id ?? null,
  );
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [conns, setConns] = useState(p.initialConnections);
  const [showAll, setShowAll] = useState(false);
  const [going, setGoing] = useState(false);
  const [pending, start] = useTransition();
  const category = p.step === 'webshop' ? 'webshop' : 'erp';
  const mine = conns.filter((c) => c.category === category);
  const working = mine.find((c) => c.status === 'ok');
  const checking = mine.some((c) => c.status === 'checking');
  const broken = !working && mine.length > 0 && mine.every((c) => c.status === 'broken');

  const refresh = useCallback(async () => {
    const r = await onboardingConnections();
    if (r.ok && r.data) setConns(r.data);
  }, []);

  // While the worker tests the new connection, and whenever the app comes back to the front
  // (back from the phone's system browser), ask again.
  useEffect(() => {
    if (!checking) return;
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [checking, refresh]);
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);
  // Just connected and it works: on to the next step, as on the boards.
  useEffect(() => {
    if (p.justConnected && working && !pending) start(() => continueOnboarding(p.step));
  }, [p.justConnected, working, pending, p.step]);

  const option = p.options.find((o) => o.id === selected) ?? null;
  const connect = () => {
    if (!option) return;
    let base = '';
    if (option.needsUrl) {
      try {
        const u = new URL(url.trim());
        if (u.protocol !== 'https:') throw new Error('https');
        base = u.origin;
      } catch (e) {
        setUrlError(
          t(
            (e as Error).message === 'https'
              ? 'connect.errors.httpsRequired'
              : 'connect.errors.badUrl',
          ),
        );
        return;
      }
    }
    setGoing(true);
    const q = new URLSearchParams({ return: `/onboarding/${p.step}` });
    if (base) q.set('baseUrl', base);
    window.location.assign(`/connect/${option.id}/start?${q.toString()}`);
  };

  const meta = (o: ConnectOption) =>
    o.soon
      ? t('connect.soon')
      : o.id === p.chosenId
        ? t('connect.chosen')
        : o.needsUrl
          ? tw('shopUrl')
          : mobile && p.step === 'accounting'
            ? t('connect.oauthShort')
            : t('connect.oauth', { name: o.name });

  const node = (o: ConnectOption | null, role: 'webshop' | 'erp' | 'later'): DiagramNode | null => {
    if (!o) return null;
    const c = conns.find((x) => x.connectorId === o.id);
    if (role === 'later')
      return { logo: o, title: o.name, detail: t('diagram.later'), state: 'later' };
    if (c?.status === 'ok')
      return {
        logo: o,
        title: o.name,
        detail: c.accounts ? t('diagram.connectedAccounts') : t('diagram.connected'),
        state: 'connected',
      };
    if (c?.status === 'broken')
      return { logo: o, title: o.name, detail: t('diagram.failed'), state: 'error' };
    const isCurrent = (p.step === 'webshop') === (role === 'webshop');
    return {
      logo: o,
      title: o.name,
      detail:
        isCurrent && (c || going || p.chosenId === o.id)
          ? t('diagram.connecting')
          : t(`diagram.${role}`),
      state: isCurrent ? 'connecting' : 'idle',
    };
  };
  const src = node(p.diagram.source, 'webshop');
  const dests = [node(p.diagram.erp, 'erp'), node(p.diagram.later, 'later')].filter(
    (n): n is DiagramNode => !!n,
  );
  const diagram = src ? (
    <ConnectionDiagram
      compact={mobile}
      label={t('diagram.label')}
      source={src}
      agentor={{ title: t('diagram.agentor'), detail: t('diagram.agentorDetail') }}
      destinations={dests}
    />
  ) : null;

  const tiles = p.options.filter((o) => o.id !== (mobile ? selected : null));
  const shown = showAll ? tiles : tiles.slice(0, mobile ? 2 : p.featured);
  const sourceConn = conns.find((c) => c.category === 'webshop' && c.status === 'ok');
  const sourceOption = p.diagram.source;

  const connectCard = option && !option.soon && (
    <section
      className={
        mobile
          ? 'flex flex-col gap-3 rounded-md bg-surface p-4 shadow-sm'
          : 'flex flex-col gap-3.5 rounded-md bg-surface p-5 shadow-sm'
      }
    >
      {(mobile || p.step === 'accounting') && (
        <span className="flex items-center gap-2.5">
          <LogoImg logo={option} size="md" decorative />
          <span className="flex flex-col leading-snug">
            <strong className="text-su-input">
              {p.step === 'accounting' ? ta('loginTitle', { name: option.name }) : option.name}
            </strong>
            {p.step === 'accounting' && !mobile && (
              <span className="text-meta font-medium text-fg-2">
                {ta('loginHint', { name: option.name, company: p.companyName })}
              </span>
            )}
          </span>
          {mobile && p.chosenId === option.id && (
            <span className="ml-auto inline-flex h-6 items-center rounded-full bg-info-bg px-2.5 text-meta font-semibold">
              {t('connect.selected')}
            </span>
          )}
        </span>
      )}
      {option.needsUrl && (
        <SignupInput
          mobile={mobile}
          type="url"
          label={tw('shopUrl')}
          placeholder="https://"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setUrlError(null);
          }}
          error={urlError ?? undefined}
        />
      )}
      {p.step === 'accounting' ? (
        <PermissionList
          items={[
            { text: ta('perm1'), allowed: true },
            { text: mobile ? ta('perm2Short') : ta('perm2'), allowed: true },
            { text: mobile ? ta('perm3Short') : ta('perm3'), allowed: true },
          ]}
        />
      ) : (
        <span className="text-meta font-medium text-fg-2">
          {mobile
            ? tw('explainMobile', { name: option.name })
            : tw('explain', { name: option.name })}
        </span>
      )}
      {broken && <Banner tone="error">{t('connect.errors.broken')}</Banner>}
      {working ? (
        <SignupButton
          mobile={mobile}
          loading={pending}
          onClick={() => start(() => continueOnboarding(p.step))}
          className={mobile ? 'w-full' : 'self-start'}
        >
          {t('connect.continue')}
        </SignupButton>
      ) : (
        <SignupButton
          mobile={mobile}
          loading={going || checking}
          onClick={connect}
          icon={<Icon icon={Link2} size={16} />}
          className={mobile ? 'w-full' : 'self-start'}
        >
          {checking
            ? t('connect.testing')
            : p.step === 'accounting'
              ? ta('login', { name: option.name })
              : tw('connect', { name: option.name })}
        </SignupButton>
      )}
    </section>
  );

  const chosen = p.options.find((o) => o.id === p.chosenId);
  const heading = (
    <SignupHeading
      mobile={mobile}
      offsetTop={!(p.step === 'accounting' && sourceConn)}
      title={ts('title')}
      lead={
        chosen
          ? mobile
            ? ts('leadMobile', { name: chosen.name })
            : ts('lead', { name: chosen.name })
          : ts('leadNone')
      }
    />
  );
  const banner =
    p.step === 'accounting' && sourceConn && sourceOption ? (
      <SuccessBanner mobile={mobile}>
        {(() => {
          const n = sourceConn.counts;
          const strong = (c: ReactNode) => <strong>{c}</strong>;
          // Desktop names what the test found; the mobile board keeps the short banner.
          if (!mobile && n && [n.order, n.customer, n.product].every((x) => typeof x === 'number'))
            return ta.rich('bannerCounts', {
              name: sourceOption.name,
              orders: n.order!,
              customers: n.customer!,
              products: n.product!,
              strong,
            });
          return ta.rich('banner', { name: sourceOption.name, strong });
        })()}
      </SuccessBanner>
    ) : null;
  const errorBanner = p.connectError ? (
    <Banner tone="error">
      {t(`connect.errors.${p.connectError}` as 'connect.errors.unknown')}
    </Banner>
  ) : null;

  const grid = (
    <div className={mobile ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2.5'}>
      {(mobile ? shown : showAll ? p.options : p.options.slice(0, p.featured)).map((o) => (
        <ConnectorTile
          key={o.id}
          mobile={mobile}
          logo={o}
          name={o.name}
          meta={meta(o)}
          selected={o.id === selected}
          pill={!mobile && o.id === p.chosenId ? t('connect.selected') : undefined}
          disabled={o.soon}
          onClick={() => setSelected(o.id)}
        />
      ))}
    </div>
  );
  const seeAll = p.options.length > (mobile ? 3 : p.featured) && (
    <p className={mobile ? 'm-0 text-center text-meta' : 'm-0 text-meta text-fg-2'}>
      {!mobile && p.step === 'webshop' && <>{tw('other')} </>}
      <button
        type="button"
        aria-expanded={showAll}
        onClick={() => setShowAll((s) => !s)}
        className="cursor-pointer border-0 bg-transparent p-0 font-sans text-meta font-semibold text-fg-1 underline"
      >
        {showAll ? ts('showFewer') : ts('seeAll', { count: p.options.length })}
      </button>
    </p>
  );

  if (mobile)
    return (
      <MobileSignupShell topRight={p.topRight} step={p.step_}>
        {banner}
        {heading}
        {errorBanner}
        {diagram && (
          <NavyCard>
            {diagram}
            <span className="text-m-note text-on-navy-muted">
              {p.step === 'accounting' && p.diagram.erp
                ? ta('caption', { name: p.diagram.erp.name })
                : tw('caption')}
            </span>
          </NavyCard>
        )}
        {connectCard}
        {grid}
        {seeAll}
      </MobileSignupShell>
    );
  return (
    <SignupShell
      wide
      alignTop
      topRight={p.topRight}
      step={p.step_}
      panel={
        <TrustPanel
          label={ts('panelTitle')}
          title={ts('panelTitle')}
          lead={
            p.step === 'accounting' && p.diagram.erp
              ? ta('panelLead', { name: p.diagram.erp.name })
              : tw('panelLead')
          }
          points={p.points}
        >
          {diagram}
        </TrustPanel>
      }
    >
      {banner}
      {heading}
      {errorBanner}
      {grid}
      {connectCard}
      {seeAll}
    </SignupShell>
  );
}
