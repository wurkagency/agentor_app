import type { Status } from '@agentor/core';
import {
  CardButton,
  ChipGroup,
  DeskNote,
  FlowCard,
  LogoChain,
  MobileCallout,
  MobileCard,
  MobilePageTitle,
  MobileShell,
  type LogoRef,
} from '@agentor/ui/mobile';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { AppTopBar } from '@/components/mobile/chrome';
import { SnapshotWriter } from '@/components/mobile/pwa';
import { FlowSelectList, type SelectableFlow } from './select-list';

export interface MobileFlow extends SelectableFlow {
  href: string;
  source: LogoRef;
  destinations: LogoRef[];
  status: Status;
  statusLabel: string;
  cardMeta: string;
}

export interface IntegrationsMobileProps {
  snapshot: { owner: string; company: string } | null;
  title: string;
  subtitle: string;
  filter: { label: string; value: string; items: { key: string; label: string; href: string }[] };
  /** "Vælg" or "Færdig" link between the card list (MA04) and the select list (MA19). */
  mode: { select: boolean; label: string; href: string };
  flows: MobileFlow[];
  limit: {
    title: string;
    body: string;
    actions: { label: string; href: string; primary?: boolean }[];
  } | null;
  empty: {
    title: string;
    body: string;
    templates: { id: string; title: string; body: string; source: LogoRef; destination: LogoRef }[];
    note: string;
  } | null;
  deskNote: string;
  canEdit: boolean;
}

/** Integrationer on mobile: cards (MA04), plan limit (MA21), empty (MA18), select mode (MA19). */
export function IntegrationsMobile(p: IntegrationsMobileProps) {
  return (
    <MobileShell topBar={<AppTopBar />}>
      {p.snapshot && !p.mode.select && (
        <SnapshotWriter
          owner={p.snapshot.owner}
          company={p.snapshot.company}
          page="integrations"
          data={p.flows.map((f) => ({
            name: f.name,
            meta: f.cardMeta,
            status: f.status,
            statusLabel: f.statusLabel,
          }))}
        />
      )}
      <MobilePageTitle
        title={p.title}
        subtitle={p.subtitle}
        {...(p.flows.length && p.canEdit
          ? {
              aside: (
                <Link
                  href={p.mode.href}
                  className="touch-target text-table font-semibold text-fg-1 underline-offset-2"
                >
                  {p.mode.label}
                </Link>
              ),
            }
          : {})}
      />
      {p.empty ? (
        <>
          <MobileCard>
            <div className="flex flex-col gap-1.5 px-4 py-4.5">
              <strong className="text-m-hero font-semibold">{p.empty.title}</strong>
              <span className="text-table font-medium text-fg-2">{p.empty.body}</span>
            </div>
          </MobileCard>
          {p.empty.templates.map((tpl) => (
            <Link
              key={tpl.id}
              href={`/integrations/new?template=${tpl.id}`}
              className="flex flex-col gap-1.5 rounded-md bg-surface px-4 py-3.5 text-fg-1 no-underline shadow-sm"
            >
              <LogoChain source={tpl.source} destinations={[tpl.destination]} />
              <strong className="text-nav font-semibold">{tpl.title}</strong>
              <span className="text-meta font-medium text-fg-2">{tpl.body}</span>
            </Link>
          ))}
          <DeskNote>{p.empty.note}</DeskNote>
        </>
      ) : (
        <>
          {p.limit && (
            <MobileCallout
              tone="warn"
              icon={TriangleAlert}
              title={p.limit.title}
              actions={p.limit.actions.map((a) => (
                <CardButton
                  key={a.href + a.label}
                  href={a.href}
                  linkAs={Link}
                  variant={a.primary ? 'primary' : 'secondary'}
                >
                  {a.label}
                </CardButton>
              ))}
            >
              {p.limit.body}
            </MobileCallout>
          )}
          <ChipGroup
            label={p.filter.label}
            value={p.filter.value}
            items={p.filter.items}
            linkAs={Link}
          />
          {p.mode.select ? (
            <FlowSelectList flows={p.flows} />
          ) : (
            p.flows.map((f) => (
              <FlowCard
                key={f.id}
                href={f.href}
                linkAs={Link}
                source={f.source}
                destinations={f.destinations}
                status={f.status}
                statusLabel={f.statusLabel}
                name={f.name}
                meta={f.cardMeta}
              />
            ))
          )}
          <DeskNote>{p.deskNote}</DeskNote>
        </>
      )}
    </MobileShell>
  );
}
