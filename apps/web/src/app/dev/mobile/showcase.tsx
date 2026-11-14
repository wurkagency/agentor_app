'use client';

import { StatusPill } from '@agentor/ui';
import {
  BigButton,
  BigButtonLink,
  CardsSkeleton,
  ChatBubble,
  ChipGroup,
  DeskNote,
  FlowCard,
  HeroSkeleton,
  InternalNote,
  KpiSkeleton,
  MobileCard,
  MobileEmpty,
  MobileError,
  MobileFootnote,
  MobileKpi,
  MobileLogo,
  MobilePageTitle,
  MobileRing,
  MobileShell,
  Modal,
  PlatformBadge,
  Row,
  RowAction,
  RowIcon,
  RowLink,
  RowsSkeleton,
  SectionHeading,
  StackedStatus,
  StackedValue,
  StatusHero,
  Switch,
  MobileTabBar,
  TimelineEvent,
  TimerBar,
  TimerBarAction,
  TrendPill,
  TopBar,
  TopBarAction,
  TopBarAvatar,
  WeekBars,
  type TabItem,
} from '@agentor/ui/mobile';
import {
  Activity,
  Building,
  CircleUserRound,
  Headphones,
  Settings,
  Check,
  CircleCheck,
  CircleX,
  CreditCard,
  Headset,
  House,
  Inbox,
  Menu,
  RefreshCw,
  Timer,
  TriangleAlert,
  Unplug,
  Workflow,
  Bell,
  Mail,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

// Fictional seed data only (designspecifikation §10.1): Nordlys Cykler ApS.
const woo = { name: 'WooCommerce', logoUrl: '/logos/woocommerce.svg' };
const shopify = { name: 'Shopify', logoUrl: '/logos/shopify.svg' };
const dinero = { name: 'Dinero', logoUrl: '/logos/dinero.svg' };
const hubspot = { name: 'HubSpot', logoUrl: '/logos/hubspot.svg' };
const economic = { name: 'e-conomic', logoUrl: '/logos/economic.svg' };
const brevo = { name: 'Brevo', logoUrl: '/logos/brevo.svg' };
const bc = { name: 'Business Central' };

const APP_TABS: TabItem[] = [
  { key: 'overview', href: '#', label: 'Overblik', icon: House },
  { key: 'integrations', href: '#', label: 'Integrationer', icon: Workflow },
  { key: 'activity', href: '#', label: 'Aktivitet', icon: Activity },
  { key: 'more', href: '#', label: 'Mere', icon: Menu },
  { key: 'profile', href: '#', label: 'Profil', icon: CircleUserRound },
];
const PLATFORM_TABS: TabItem[] = [
  { key: 'customers', href: '#', label: 'Kunder', icon: Building },
  { key: 'support', href: '#', label: 'Support', icon: Headphones },
  { key: 'finance', href: '#', label: 'Finans', icon: CreditCard },
  { key: 'admin', href: '#', label: 'Admin', icon: Settings },
  { key: 'profile', href: '#', label: 'Profil', icon: CircleUserRound },
];

const WEEK = [
  { label: 'tir.', records: 1050, errors: 0, description: 'tirsdag: 1.050 records, ingen fejl' },
  { label: 'ons.', records: 1175, errors: 2, description: 'onsdag: 1.175 records, 2 fejl' },
  { label: 'tor.', records: 1125, errors: 0, description: 'torsdag: 1.125 records, ingen fejl' },
  { label: 'fre.', records: 1250, errors: 1, description: 'fredag: 1.250 records, 1 fejl' },
  { label: 'lør.', records: 525, errors: 0, description: 'lørdag: 525 records, ingen fejl' },
  { label: 'søn.', records: 400, errors: 0, description: 'søndag: 400 records, ingen fejl' },
  {
    label: 'i dag',
    records: 1125,
    errors: 0,
    today: true,
    description: 'i dag: 1.125 records, ingen fejl',
  },
];

const bell = { href: '#', count: 2, severe: true, label: 'Notifikationer, 2 nye' };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-3" data-testid={id}>
      <h2 id={`${id}-h`} className="m-0 px-1 text-card">
        {title}
      </h2>
      {children}
    </section>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="eyebrow m-0 px-1">{label}</p>
      {children}
    </div>
  );
}

/** A framed preview of a page: the shell with a static tab bar. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-hidden shadow-hairline-y" data-testid="frame">
      {children}
    </div>
  );
}

export function MobileShowcase() {
  const [filter, setFilter] = useState('all');
  const [kind, setKind] = useState('phone');
  const [minutes, setMinutes] = useState('15');
  const [push, setPush] = useState({ errors: true, weekly: false });
  const [billable, setBillable] = useState(true);
  const [modal, setModal] = useState(false);

  return (
    <MobileShell
      mainId="main"
      topBar={<TopBar logo={{ href: '/', label: 'Agentor, gå til Overblik' }} linkAs={Link} />}
      className="mx-auto max-w-form"
    >
      <MobilePageTitle
        title="Mobilkomponenter"
        subtitle="Alle komponenter i alle tilstande · MA01–MA15, MP01–MP07"
      />

      <Section id="shell" title="MobileShell · TopBar · MobileTabBar">
        <State label="Kunde · logo og klokke (MA02)">
          <Frame>
            <TopBar logo={{ href: '#', label: 'Agentor, gå til Overblik' }} bell={bell} />
          </Frame>
        </State>
        <State label="Kunde · tilbage, titel og undertitel (MA05)">
          <Frame>
            <TopBar
              back={{ href: '#', label: 'Tilbage' }}
              title="Webshop → regnskab og CRM"
              subtitle="WooCommerce → Dinero, HubSpot"
              bell={{ ...bell, severe: false, count: 1, label: 'Notifikationer, 1 ny' }}
            />
          </Frame>
        </State>
        <State label="Kunde · uden klokke, intet ulæst (MA11)">
          <Frame>
            <TopBar back={{ href: '#', label: 'Tilbage' }} title="Notifikationer" />
          </Frame>
        </State>
        <State label="Platform · navy med mærke og avatar (MP01)">
          <Frame>
            <TopBar
              variant="platform"
              logo={{
                href: '#',
                label: 'Agentor Platform, gå til Kunder',
                badge: <PlatformBadge>Platform</PlatformBadge>,
              }}
              actions={<TopBarAvatar initials="AS" label="Profil: Anne Sørensen" href="#" />}
            />
          </Frame>
        </State>
        <State label="Platform · sag med handling (MP03)">
          <Frame>
            <TopBar
              variant="platform"
              back={{ href: '#', label: 'Tilbage' }}
              title="#2291 · Fakturaer til EU-kunder fejler"
              subtitle="Nordlys Cykler ApS · Mette Holm"
              actions={<TopBarAction icon={Timer} label="Registrér tid" href="#" onNavy />}
            />
          </Frame>
        </State>
        <State label="MobileTabBar · kunde, Overblik aktiv">
          <Frame>
            <MobileTabBar items={APP_TABS} active="overview" label="Hovedmenu" fixed={false} />
          </Frame>
        </State>
        <State label="MobileTabBar · Platform, Superadmin, Finans aktiv">
          <Frame>
            <MobileTabBar
              items={PLATFORM_TABS}
              active="finance"
              label="Platformmenu"
              variant="platform"
              fixed={false}
            />
          </Frame>
        </State>
        <State label="MobileTabBar · Platform, Supporter (ingen Finans)">
          <Frame>
            <MobileTabBar
              items={PLATFORM_TABS.filter((t) => t.key !== 'finance' && t.key !== 'admin')}
              active="support"
              label="Platformmenu, supporter"
              variant="platform"
              fixed={false}
            />
          </Frame>
        </State>
      </Section>

      <Section id="hero" title="StatusHero">
        <State label="Alt kører (MA02)">
          <StatusHero
            tone="ok"
            icon={CircleCheck}
            headline="Alt kører"
            meta="6 flows · 0 fejl i dag · tjekket for 1 min. siden"
          />
        </State>
        <State label="Problemer med rækker (MA03)">
          <StatusHero
            tone="error"
            icon={TriangleAlert}
            headline="2 ting kræver handling"
            meta="4 andre flows kører fint"
          >
            <RowLink
              href="#"
              leading={<RowIcon icon={Unplug} tone="error" />}
              title="e-conomic er afbrudt"
              meta="Outlet → regnskab står stille siden i går 09:14"
              trailing={<RowAction>Genforbind</RowAction>}
            />
            <RowLink
              href="#"
              leading={<RowIcon icon={CircleX} tone="error" />}
              title="3 ordrer blev ikke bogført"
              meta="Webshop → regnskab og CRM · 14:02"
            />
          </StatusHero>
        </State>
        <State label="Indlæser">
          <HeroSkeleton label="Indlæser status" />
        </State>
        <State label="Fejl">
          <MobileError message="Kunne ikke hente data" retryLabel="Prøv igen" onRetry={() => {}} />
        </State>
      </Section>

      <Section id="rows" title="RowLink · Row">
        <State label="Indhold (MA03 Flows, MA05 Ruter, MA10, MP06)">
          <MobileCard>
            <RowLink
              href="#"
              leading={<MobileLogo {...woo} />}
              title="Webshop → regnskab og CRM"
              meta="1 fejl · sidst kørt for 4 min. siden"
              trailing={<StatusPill status="error">Fejl</StatusPill>}
            />
            <RowLink
              href="#"
              leading={<MobileLogo {...shopify} />}
              title="Outlet → regnskab"
              meta="Står stille siden i går 09:14"
              trailing={<StatusPill status="broken">Afbrudt</StatusPill>}
            />
            <Row
              title="Ordrer → Dinero Fakturaer"
              meta="3 fejlet · konto 1010 findes ikke"
              trailing={<StackedStatus status="error" label="Fejl" meta="Live" />}
            />
            <Row
              title="Kunder → HubSpot Kontakter"
              meta="for 4 min. siden"
              trailing={<StackedStatus status="info" label="Test" meta="Test" />}
            />
            <RowLink
              href="#"
              leading={<RowIcon icon={Headset} />}
              title="Supportadgang"
              meta="1 anmodning venter"
              trailing={
                <span className="inline-flex h-5.5 items-center rounded-full bg-error-fg px-2.25 text-meta font-semibold text-white">
                  1
                </span>
              }
            />
            <RowLink
              href="#"
              title="Mdl. abonnementsomsætning"
              trailing={
                <StackedValue
                  value="25.894 kr."
                  pill={<TrendPill growth={{ direction: 'up', text: '4,5 %', tone: 'good' }} />}
                />
              }
            />
            <Row
              leading={<MobileLogo {...bc} />}
              title="Business Central"
              meta="Uden logo: initialer"
            />
          </MobileCard>
        </State>
        <State label="Ikontoner">
          <MobileCard>
            <div className="flex flex-wrap gap-3 p-4">
              <RowIcon icon={CircleX} tone="error" />
              <RowIcon icon={TriangleAlert} tone="warn" />
              <RowIcon icon={CircleCheck} tone="ok" size={28} />
              <RowIcon icon={Bell} tone="info" />
              <RowIcon icon={Headset} tone="lime" />
              <RowIcon icon={Headset} tone="neutral" size={30} />
              <RowIcon icon={Check} tone="dark" size={40} />
              <RowIcon icon={Headset} tone="lime" size={52} />
            </div>
          </MobileCard>
        </State>
        <State label="Indlæser">
          <RowsSkeleton label="Indlæser flows" rows={3} />
        </State>
        <State label="Tom">
          <MobileEmpty icon={Inbox} title="Ingen notifikationer">
            Du får besked her, når noget kræver din opmærksomhed.
          </MobileEmpty>
        </State>
        <State label="Fejl">
          <MobileError message="Kunne ikke hente data" retryLabel="Prøv igen" retryHref="#" />
        </State>
      </Section>

      <Section id="flowcard" title="FlowCard">
        <State label="Indhold (MA04)">
          <FlowCard
            href="#"
            source={woo}
            destinations={[dinero, hubspot]}
            status="error"
            statusLabel="Fejl"
            name="Webshop → regnskab og CRM"
            meta="5 ruter · 1.284 records i dag · for 4 min. siden"
          />
          <FlowCard
            href="#"
            source={shopify}
            destinations={[economic]}
            status="broken"
            statusLabel="Afbrudt"
            name="Outlet → regnskab"
            meta="3 ruter · står stille siden i går 09:14"
          />
          <FlowCard
            href="#"
            source={shopify}
            destinations={[brevo]}
            status="ok"
            statusLabel="Aktiv"
            name="Kunder til nyhedsbrev"
            meta="1 rute · 204 records i 7 dage · for 12 min. siden"
          />
          <FlowCard
            href="#"
            source={dinero}
            destinations={[woo]}
            status="paused"
            statusLabel="Pauset"
            name="Lager retur"
            meta="1 rute · sat på pause af Jonas Krag"
          />
        </State>
        <State label="Indlæser">
          <CardsSkeleton label="Indlæser integrationer" cards={2} />
        </State>
        <State label="Tom">
          <MobileEmpty icon={Workflow} title="Ingen flows endnu">
            Nye flows laves på computer.
          </MobileEmpty>
        </State>
      </Section>

      <Section id="kpi" title="MobileKpi · MobileRing · WeekBars">
        <State label="Indhold (MA02)">
          <div className="grid grid-cols-2 gap-2.5">
            <MobileKpi
              featured
              label="Records i dag"
              trend={{ direction: 'up', text: '6 %', tone: 'good' }}
              value="1.284"
              data={[100, 104, 112, 123, 135, 147, 158, 168, 177, 186]}
              meta="Mandag sidste uge 1.211"
            />
            <MobileRing
              label="Transaktioner"
              ratio={0.71}
              percentLabel="71%"
              value="1.420"
              of="af 2.000"
              meta="Nulstilles 1. nov."
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <MobileKpi
              featured
              label="Records i dag"
              trend={{ direction: 'up', text: '3 fejlet', tone: 'bad' }}
              value="1.281"
              data={[100, 104, 112, 123, 135, 147, 158, 168, 177, 186]}
              meta="Mandag sidste uge 1.211"
            />
            <MobileKpi
              label="Fejlrate"
              trend={{ direction: 'flat', text: 'Stabil', tone: 'neutral' }}
              value="0,3 %"
              data={[3, 2, 4, 3, 3, 2, 3]}
              meta="Sidste 7 dage"
            />
          </div>
          <WeekBars title="Sidste 7 dage" summary="7.639 records · 3 fejl" days={WEEK} />
        </State>
        <State label="Tom kvote og ingen records">
          <div className="grid grid-cols-2 gap-2.5">
            <MobileKpi featured label="Records i dag" value="0" meta="Ingen kørsler endnu" />
            <MobileRing
              label="Transaktioner"
              ratio={0}
              percentLabel="0%"
              value="0"
              of="af 2.000"
              meta="Nulstilles 1. nov."
            />
          </div>
          <WeekBars
            title="Sidste 7 dage"
            summary="0 records"
            days={WEEK.map((d) => ({ ...d, records: 0, errors: 0 }))}
          />
        </State>
        <State label="Indlæser">
          <KpiSkeleton label="Indlæser nøgletal" />
        </State>
      </Section>

      <Section id="text" title="SectionHeading · DeskNote · Footnote">
        <SectionHeading>Seneste aktivitet</SectionHeading>
        <DeskNote>
          Nye flows og mapping laves på computer. Her kan du følge med, pause og gentage.
        </DeskNote>
        <DeskNote>Mapping, filtre og nye ruter ændres i editoren på computer.</DeskNote>
        <MobileFootnote>E-mail og SMS vælges under Indstillinger på computer.</MobileFootnote>
      </Section>

      <Section id="controls" title="Chips · Switch · BigButton">
        <State label="Chips som knapper (MA04)">
          <ChipGroup
            label="Filter"
            value={filter}
            onChange={setFilter}
            items={[
              { key: 'all', label: 'Alle 6' },
              { key: 'problems', label: 'Problemer 2' },
              { key: 'paused', label: 'Pauset 1' },
            ]}
          />
        </State>
        <State label="Chips der brydes og centreres (MP04), deaktiveret">
          <ChipGroup
            label="Type"
            value={kind}
            onChange={setKind}
            wrap
            center
            items={[
              { key: 'phone', label: 'Telefon' },
              { key: 'email', label: 'E-mail' },
              { key: 'clarify', label: 'Afklaring' },
              { key: 'other', label: 'Andet', disabled: true },
            ]}
          />
        </State>
        <State label="Chips som links (MP02)">
          <ChipGroup
            label="Sager"
            value="mine"
            linkAs={Link}
            items={[
              { key: 'mine', label: 'Mine 3', href: '#' },
              { key: 'unassigned', label: 'Ikke tildelt 2', href: '#' },
              { key: 'waiting', label: 'Venter 3', href: '#' },
            ]}
          />
        </State>
        <State label="Switch i rækker (MA11)">
          <MobileCard>
            <Row
              title="Fejl i et flow"
              meta="Med det samme"
              trailing={
                <Switch
                  label="Fejl i et flow"
                  checked={push.errors}
                  onCheckedChange={(v) => setPush((p) => ({ ...p, errors: v }))}
                />
              }
            />
            <Row
              title="Ugens opsummering"
              meta="Mandag kl. 08"
              trailing={
                <Switch
                  label="Ugens opsummering"
                  checked={push.weekly}
                  onCheckedChange={(v) => setPush((p) => ({ ...p, weekly: v }))}
                />
              }
            />
            <Row
              title="Push på denne telefon"
              meta="Kræver at Agentor er på hjemmeskærmen"
              trailing={<Switch label="Push på denne telefon" checked={false} disabled />}
            />
          </MobileCard>
        </State>
        <State label="BigButton">
          <BigButton icon={RefreshCw}>Gentag 3 ordrer</BigButton>
          <BigButton variant="secondary" icon={Mail}>
            Send link til min computer
          </BigButton>
          <div className="flex gap-2">
            <BigButton variant="secondary" className="flex-1">
              Afvis
            </BigButton>
            <BigButton icon={Check} className="flex-1">
              Godkend
            </BigButton>
          </div>
          <BigButton variant="dark">Log ind hos e-conomic</BigButton>
          <BigButton variant="destructive">Afslut adgang</BigButton>
          <BigButton loading>Gentager…</BigButton>
          <BigButton disabled>Gentag 3 ordrer</BigButton>
          <BigButtonLink href="#" variant="secondary" linkAs={Link}>
            Senere
          </BigButtonLink>
        </State>
      </Section>

      <Section id="modal" title="Modal (MP04)">
        <BigButton variant="secondary" icon={Timer} onClick={() => setModal(true)}>
          Åbn Registrér tid
        </BigButton>
        <Modal
          open={modal}
          onOpenChange={setModal}
          title="Registrér tid"
          description="#2291 · Nordlys Cykler ApS"
          closeLabel="Luk"
          footer={
            <>
              <BigButton variant="secondary" className="flex-1" onClick={() => setModal(false)}>
                Annullér
              </BigButton>
              <BigButton icon={Check} style={{ flex: 1.4 }} onClick={() => setModal(false)}>
                Gem {minutes === '60' ? '1 time' : `${minutes} min.`}
              </BigButton>
            </>
          }
        >
          <div className="flex flex-col items-center gap-1">
            <strong className="text-stat tracking-tight tabular">
              {minutes === '60' ? '1:00' : `0:${minutes}`}
            </strong>
            <span className="text-meta font-medium text-fg-2">
              Timer stoppet · 12 min. 40 s. rundet op
            </span>
          </div>
          <ChipGroup
            label="Varighed"
            value={minutes}
            onChange={setMinutes}
            wrap
            center
            items={[
              { key: '15', label: '15 min.' },
              { key: '30', label: '30 min.' },
              { key: '60', label: '1 time' },
            ]}
          />
          <ChipGroup
            label="Type"
            value={kind}
            onChange={setKind}
            wrap
            center
            items={[
              { key: 'phone', label: 'Telefon' },
              { key: 'email', label: 'E-mail' },
              { key: 'clarify', label: 'Afklaring' },
              { key: 'other', label: 'Andet' },
            ]}
          />
          <label className="flex flex-col gap-1.5 text-table font-medium">
            Beskrivelse
            <input
              defaultValue="Gennemgik mapping med Mette i telefonen"
              className="h-11 rounded-field border border-border bg-white px-3 font-sans text-nav"
            />
          </label>
          <div className="flex items-center justify-between">
            <span className="flex flex-col">
              <strong className="text-body">Fakturerbar tid</strong>
              <span className="text-meta font-medium text-fg-2">Abonnement: Business</span>
            </span>
            <Switch label="Fakturerbar tid" checked={billable} onCheckedChange={setBillable} />
          </div>
        </Modal>
      </Section>

      <Section id="chat" title="ChatBubble · InternalNote · TimerBar (MP03)">
        <div className="flex flex-col gap-3 rounded-md bg-canvas">
          <ChatBubble from="customer" author="Mette Holm" time="11:02">
            Fakturaer til EU-kunder fejler siden i morges. Kan I kigge på det?
          </ChatBubble>
          <ChatBubble from="agentor" author="Anne Sørensen" time="11:59">
            Kontoen til EU-salg (1010) findes ikke længere i Dinero. Vælg 1015 Salg EU under Mapping
            › Konti og publicér.
          </ChatBubble>
          <InternalNote label="Intern note · Anne · 11:57">
            Konto 1010 slettet i Dinero. Kunden skal vælge 1015. Ingen ændringer gemt.
          </InternalNote>
          <TimelineEvent>Supportsession gemt · 42 min. · 11:57</TimelineEvent>
        </div>
        <Frame>
          <TimerBar
            fixed={false}
            time="00:12:40"
            label="på sagen"
            action={<TimerBarAction onClick={() => setModal(true)}>Stop og gem</TimerBarAction>}
          />
        </Frame>
      </Section>
    </MobileShell>
  );
}
