import type { Status } from '@agentor/core';
import { StatusPill } from '@agentor/ui';
import {
  Chevron,
  MobileCard,
  MobileKpi,
  MobileLogo,
  MobilePageTitle,
  MobileRing,
  MobileShell,
  RowAction,
  RowIcon,
  RowLink,
  SectionHeading,
  StatusHero,
  WeekBars,
  type WeekDay,
} from '@agentor/ui/mobile';
import type { Growth } from '@agentor/ui';
import { CircleCheck, CircleX, TriangleAlert, Unplug } from 'lucide-react';
import Link from 'next/link';
import { AppTopBar } from '@/components/mobile/chrome';

export interface OverviewMobileProps {
  title: string;
  subtitle: string;
  hero: { problems: boolean; headline: string; meta: string };
  issues: {
    key: string;
    status: 'broken' | 'error';
    title: string;
    meta: string;
    href: string;
    action?: string;
  }[];
  kpi: { label: string; value: string; trend?: Growth; data: number[]; meta: string };
  ring: {
    label: string;
    ratio: number;
    percent: string;
    value: string;
    of: string;
    meta: string;
  } | null;
  week: { title: string; summary: string; days: WeekDay[] };
  /** MA03: the flows that need something, then one row for the rest. */
  flows: {
    heading: string;
    rows: {
      id: string;
      href: string;
      name: string;
      meta: string;
      status: Status;
      statusLabel: string;
      logo: { name: string; logoUrl?: string };
    }[];
    rest: { title: string; meta: string } | null;
  } | null;
  recent: {
    heading: string;
    rows: { key: string; title: string; meta: string; logo: { name: string; logoUrl?: string } }[];
  };
}

/** Overblik on mobile (MA02 alt kører, MA03 problemer). */
export function OverviewMobile(p: OverviewMobileProps) {
  return (
    <MobileShell topBar={<AppTopBar />}>
      <MobilePageTitle title={p.title} subtitle={p.subtitle} />
      <StatusHero
        tone={p.hero.problems ? 'error' : 'ok'}
        icon={p.hero.problems ? TriangleAlert : CircleCheck}
        headline={p.hero.headline}
        meta={p.hero.meta}
      >
        {p.issues.length > 0 &&
          p.issues.map((i) => (
            <RowLink
              key={i.key}
              href={i.href}
              linkAs={Link}
              leading={<RowIcon icon={i.status === 'broken' ? Unplug : CircleX} tone="error" />}
              title={i.title}
              meta={i.meta}
              trailing={i.action ? <RowAction>{i.action}</RowAction> : <Chevron />}
            />
          ))}
      </StatusHero>
      <div className="grid grid-cols-2 gap-2.5">
        <MobileKpi
          featured
          label={p.kpi.label}
          trend={p.kpi.trend}
          value={p.kpi.value}
          data={p.kpi.data}
          meta={p.kpi.meta}
        />
        {p.ring && (
          <MobileRing
            label={p.ring.label}
            ratio={p.ring.ratio}
            percentLabel={p.ring.percent}
            value={p.ring.value}
            of={p.ring.of}
            meta={p.ring.meta}
          />
        )}
      </div>
      {p.flows ? (
        <>
          <SectionHeading>{p.flows.heading}</SectionHeading>
          <MobileCard>
            {p.flows.rows.map((f) => (
              <RowLink
                key={f.id}
                href={f.href}
                linkAs={Link}
                leading={<MobileLogo {...f.logo} />}
                title={f.name}
                meta={f.meta}
                trailing={<StatusPill status={f.status}>{f.statusLabel}</StatusPill>}
              />
            ))}
            {p.flows.rest && (
              <RowLink
                href="/integrations"
                linkAs={Link}
                leading={<RowIcon icon={CircleCheck} tone="ok" size={28} />}
                title={p.flows.rest.title}
                meta={p.flows.rest.meta}
              />
            )}
          </MobileCard>
        </>
      ) : (
        <>
          <WeekBars title={p.week.title} summary={p.week.summary} days={p.week.days} />
          {p.recent.rows.length > 0 && (
            <>
              <SectionHeading>{p.recent.heading}</SectionHeading>
              <MobileCard>
                {p.recent.rows.map((r) => (
                  <RowLink
                    key={r.key}
                    href="/activity"
                    linkAs={Link}
                    leading={<MobileLogo {...r.logo} />}
                    title={r.title}
                    meta={r.meta}
                    trailing={false}
                  />
                ))}
              </MobileCard>
            </>
          )}
        </>
      )}
    </MobileShell>
  );
}
