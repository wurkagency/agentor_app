'use client';

import {
  Advanced,
  Avatar,
  Banner,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Combobox,
  ConnectorLogo,
  ConnectorPair,
  DestructiveDialog,
  Dialog,
  EmptyState,
  ErrorCard,
  Field,
  FilterChip,
  Icon,
  Input,
  KeyValueList,
  LoadError,
  Loading,
  LockedValue,
  ModeBadge,
  Radio,
  RadioCard,
  RadioGroup,
  RowActions,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
  StatCard,
  StatusPill,
  Switch,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Th,
  Tooltip,
  Tr,
  UsageMeter,
  toast,
  type ConnectorRef,
} from '@agentor/ui';
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Pause,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Children, useState, type ReactNode } from 'react';

const logo = (file: string, name: string): ConnectorRef => ({
  name,
  logoUrl: `/logos/${file}.svg`,
});
const WOO = logo('woocommerce', 'WooCommerce');
const SHOPIFY = logo('shopify', 'Shopify');
const DINERO = logo('dinero', 'Dinero');
const ECONOMIC = logo('economic', 'e-conomic');
const HUBSPOT = logo('hubspot', 'HubSpot');
const BREVO = logo('brevo', 'Brevo');
const MAILCHIMP = logo('mailchimp', 'Mailchimp');

function Section({
  id,
  title,
  meta,
  children,
}: {
  id: string;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-5" id={id} data-testid={`sheet-${id}`}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-section">{title}</h2>
        {meta && <span className="text-meta font-medium text-fg-2">{meta}</span>}
      </div>
      {children}
    </Card>
  );
}

// Display order on the component sheet (not severity order).
const STATUSES = ['ok', 'warn', 'error', 'broken', 'paused', 'info', 'draft'] as const;

const ACCOUNTS = [
  { value: '1000', code: '1000', label: 'Salg' },
  { value: '1010', code: '1010', label: 'Salg EU', missing: true },
  { value: '1015', code: '1015', label: 'Salg EU B2B' },
  { value: '1020', code: '1020', label: 'Salg tøj' },
  { value: '1030', code: '1030', label: 'Værkstedssalg' },
  { value: '1100', code: '1100', label: 'Fragt' },
  { value: '6900', code: '6900', label: 'Gavekort (momsfri)' },
];

export function Showcase() {
  const t = useTranslations();
  const [seg, setSeg] = useState<'today' | '7d' | '30d'>('7d');
  const [mode, setMode] = useState<'basic' | 'developer'>('basic');
  const [chip, setChip] = useState(true);
  const [sw, setSw] = useState(true);
  const [account, setAccount] = useState<string | null>('1010');
  const [advanced, setAdvanced] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [destructive, setDestructive] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const close = t('common.close');
  const variants = [
    ['primary', t('dev.newFlow'), t('dev.creating'), 'l'],
    ['primary', t('dev.publish'), t('dev.publishing'), 'm'],
    ['secondary', t('dev.testRun'), t('dev.running'), 'm'],
    ['ghost', t('dev.validate'), t('dev.validating'), 'm'],
    ['dark', t('dev.reauth'), t('dev.connecting'), 'm'],
    ['destructive', t('dev.deleteFlow'), t('dev.deleting'), 'm'],
  ] as const;

  return (
    <main className="mx-auto flex max-w-content flex-col gap-8 px-gutter py-12">
      <header className="flex flex-col gap-2">
        <p className="eyebrow m-0">Komponentark</p>
        <h1 className="m-0 text-page">{t('dev.title')}</h1>
        <p className="m-0 text-fg-2">{t('dev.intro')}</p>
      </header>

      <Section id="button" title="Button" meta="Pill · L 48 kun primær CTA · M 36 · S 28">
        <div className="grid grid-cols-4 items-center gap-x-3 gap-y-4">
          <span />
          <span className="text-meta font-medium text-fg-2">Standard</span>
          <span className="text-meta font-medium text-fg-2">Deaktiveret</span>
          <span className="text-meta font-medium text-fg-2">Indlæser</span>
          {variants.map(([variant, label, busy, size]) => (
            <Row key={`${variant}-${size}`} label={`${variant} ${size.toUpperCase()}`}>
              <Button
                variant={variant}
                size={size}
                icon={
                  variant === 'primary' && size === 'l'
                    ? Plus
                    : variant === 'destructive'
                      ? Trash2
                      : undefined
                }
                data-testid={`btn-${variant}-${size}`}
              >
                {label}
              </Button>
              <Button variant={variant} size={size} disabled>
                {label}
              </Button>
              <Button variant={variant} size={size} loading>
                {busy}
              </Button>
            </Row>
          ))}
          <Row label="small S">
            <Button size="s" variant="secondary" data-testid="btn-secondary-s">
              Gentag
            </Button>
            <Button size="s" variant="secondary" disabled>
              Gentag
            </Button>
            <Button size="s" variant="primary">
              {t('dev.fixAccount')}
            </Button>
          </Row>
          <Row label="kun ikon 32">
            <Tooltip content={t('common.moreActions')}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.moreActions')}
                data-testid="btn-icon"
              >
                <Icon icon={Ellipsis} size={18} />
              </Button>
            </Tooltip>
            <Button variant="ghost" size="icon" aria-label={t('common.moreActions')} disabled>
              <Icon icon={Ellipsis} size={18} />
            </Button>
            <Button variant="secondary" size="icon" aria-label="Pause">
              <Icon icon={Pause} size={18} />
            </Button>
          </Row>
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-6">
        <Section id="status" title="StatusPill" meta="24 høj · ikon 14 · tekst 12/600">
          <div className="flex flex-wrap gap-2.5">
            {STATUSES.map((s) => (
              <StatusPill key={s} status={s}>
                {t(`status.${s}`)}
              </StatusPill>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <StatusPill status="error">
              {t('status.since', { status: t('status.error'), time: '14:02' })}
            </StatusPill>
            <StatusPill status="broken">
              {t('status.since', { status: t('status.broken'), time: 'i går' })}
            </StatusPill>
          </div>
          <div className="flex flex-wrap gap-5">
            {STATUSES.map((s) => (
              <StatusPill key={s} status={s} compact>
                {t(`status.${s}`)}
              </StatusPill>
            ))}
          </div>
        </Section>
        <Section id="mode" title="ModeBadge" meta="22 høj">
          <div className="flex flex-wrap gap-2.5">
            <ModeBadge mode="live">{t('mode.live')}</ModeBadge>
            <ModeBadge mode="draft">{t('mode.draft')}</ModeBadge>
            <ModeBadge mode="test">{t('mode.test')}</ModeBadge>
          </div>
          <div className="flex flex-col gap-2.5 text-table">
            <span className="flex items-center gap-2">
              <span className="w-50">Ordrer → Fakturaer</span>
              <ModeBadge mode="live">{t('mode.live')}</ModeBadge>
              <StatusPill status="ok">{t('status.ok')}</StatusPill>
            </span>
            <span className="flex items-center gap-2">
              <span className="w-50">Kreditnotaer → Kreditnotaer</span>
              <ModeBadge mode="live">{t('mode.live')}</ModeBadge>
              <StatusPill status="error">{t('status.error')}</StatusPill>
            </span>
            <span className="flex items-center gap-2">
              <span className="w-50">Kunder → Kontakter</span>
              <ModeBadge mode="test">{t('mode.test')}</ModeBadge>
              <StatusPill status="info">{t('status.info')}</StatusPill>
            </span>
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Section id="logo" title="ConnectorLogo" meta="24 · 32 · 48 · radius 8 · 1 px linje">
          <div className="flex items-end gap-6">
            <ConnectorLogo connector={WOO} size={24} />
            <ConnectorLogo connector={WOO} size={32} />
            <ConnectorLogo connector={WOO} size={48} />
            <ConnectorLogo connector={{ name: 'Business Central' }} size={48} />
          </div>
          <div className="flex gap-2">
            {[WOO, SHOPIFY, DINERO, ECONOMIC, HUBSPOT, BREVO, MAILCHIMP].map((c) => (
              <ConnectorLogo key={c.name} connector={c} />
            ))}
          </div>
        </Section>
        <Section id="pair" title="ConnectorPair" meta='1 → N · overlap 6 · maks. 4 + "+N"'>
          <ConnectorPair source={SHOPIFY} destinations={[ECONOMIC]} />
          <ConnectorPair source={WOO} destinations={[DINERO, HUBSPOT, BREVO]} />
          <ConnectorPair
            source={WOO}
            destinations={[DINERO, HUBSPOT, BREVO, MAILCHIMP, ECONOMIC, SHOPIFY]}
          />
        </Section>
      </div>

      <Section id="stat" title="StatCard" meta="Label 13/500 · tal 40/700 · trend i fg-1">
        <div className="grid grid-cols-4 gap-6">
          <StatCard
            variant="lime"
            label="Synkroniseret omsætning"
            value="184.320"
            unit="kr."
            trend={{ direction: 'up', text: '12 %' }}
            sparkline={[12, 14, 13, 17, 16, 19, 22]}
            tooltip="Summen af ordrer, Agentor har sendt videre. Ikke bogført omsætning."
          />
          <StatCard
            label="Ordrer"
            value="412"
            trend={{ direction: 'up', text: '8 %' }}
            sparkline={[40, 52, 48, 61, 58, 66, 70]}
          />
          <StatCard
            label="Records"
            value="1.906"
            trend={{ direction: 'flat', text: 'Som sidste uge' }}
          />
          <StatCard
            label="Fejlrate"
            value="0,4"
            unit="%"
            trend={{ direction: 'down', text: '0,2 point' }}
          />
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-6">
        <Section id="chips" title="FilterChip og faner">
          <div className="flex flex-wrap gap-2">
            <FilterChip menu>Status</FilterChip>
            <FilterChip menu>Kilde</FilterChip>
            <FilterChip active={chip} onClick={() => setChip((c) => !c)} count={2}>
              Status: Fejl
            </FilterChip>
            <FilterChip active onRemove={() => undefined} removeLabel={t('common.remove')}>
              Tilstand: Live
            </FilterChip>
            <FilterChip disabled>Tilstand</FilterChip>
          </div>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Oversigt</TabsTrigger>
              <TabsTrigger value="runs">Kørsler</TabsTrigger>
              <TabsTrigger value="routes">Ruter</TabsTrigger>
              <TabsTrigger value="settings">Indstillinger</TabsTrigger>
            </TabsList>
            {['overview', 'runs', 'routes', 'settings'].map((v) => (
              <TabsContent key={v} value={v} />
            ))}
          </Tabs>
          <Tabs defaultValue="mapping">
            <TabsList dense>
              <TabsTrigger dense value="general">
                Generelt
              </TabsTrigger>
              <TabsTrigger dense value="mapping" dirty dirtyLabel="Ugemte ændringer">
                Mapping
              </TabsTrigger>
              <TabsTrigger dense value="filters">
                Filtre
              </TabsTrigger>
              <TabsTrigger dense value="run">
                Kørsel
              </TabsTrigger>
              <TabsTrigger dense value="history">
                Historik
              </TabsTrigger>
            </TabsList>
            {['general', 'filters', 'run', 'history'].map((v) => (
              <TabsContent key={v} value={v} />
            ))}
            <TabsContent value="mapping" className="pt-3 text-table text-fg-2">
              Ugemte ændringer vises med en prik på fanen.
            </TabsContent>
          </Tabs>
          <div className="flex flex-wrap items-center gap-4">
            <Segmented
              aria-label="Periode"
              value={seg}
              onValueChange={setSeg}
              options={[
                { value: 'today', label: 'I dag' },
                { value: '7d', label: '7 dage' },
                { value: '30d', label: '30 dage' },
              ]}
            />
            <Segmented
              aria-label="Visning"
              tone="dark"
              value={mode}
              onValueChange={setMode}
              options={[
                { value: 'basic', label: 'Basic' },
                { value: 'developer', label: 'Developer' },
              ]}
            />
          </div>
        </Section>
        <Section id="controls" title="Switch, afkrydsning og radio">
          <label className="flex items-center gap-3 text-body">
            <Switch checked={sw} onCheckedChange={setSw} />
            Opdatér eksisterende
          </label>
          <label className="flex items-center gap-3 text-body">
            <Switch disabled />
            Deaktiveret
          </label>
          <div className="flex items-center gap-4">
            <Checkbox defaultChecked aria-label="Valgt" />
            <Checkbox aria-label="Ikke valgt" />
            <Checkbox size={16} defaultChecked aria-label="Valgt (tabel)" />
            <Checkbox disabled aria-label="Deaktiveret" />
          </div>
          <RadioGroup defaultValue="draft" aria-label="Sådan oprettes fakturaer i Dinero">
            <RadioCard
              value="draft"
              title="Som kladde, uden bogføring"
              description="Bogholderen godkender fakturaerne i Dinero."
            />
            <RadioCard
              value="live"
              title="Bogfør med det samme (Live)"
              description="Fakturaerne bogføres, når de oprettes."
            />
          </RadioGroup>
          <RadioGroup defaultValue="a" className="flex-row gap-4" aria-label="Radio">
            <label className="flex items-center gap-2 text-body">
              <Radio value="a" /> Kilde vinder
            </label>
            <label className="flex items-center gap-2 text-body">
              <Radio value="b" /> Destination vinder
            </label>
          </RadioGroup>
        </Section>
      </div>

      <Section
        id="inputs"
        title="Input, Select og Combobox"
        meta="40 px · 36 i inspektør · radius 8"
      >
        <div className="grid grid-cols-3 gap-6">
          <Field label="Flowets navn" help="Vises i oversigten.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                defaultValue="Webshop → regnskab og CRM"
              />
            )}
          </Field>
          <Field label="Butikkens adresse" error="Adressen skal starte med https://.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                defaultValue="http://nordlys-cykler.dk"
              />
            )}
          </Field>
          <Field label="Konto-id">
            {({ id }) => <Input id={id} readOnly mono defaultValue="412983" />}
          </Field>
          <Field label="Søg">
            {({ id }) => (
              <Input
                id={id}
                leadingIcon={<Icon icon={Search} size={16} />}
                placeholder="Søg ordrenummer, kunde eller e-mail"
              />
            )}
          </Field>
          <Field label="Send når">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                defaultValue="completed"
                options={[
                  { value: 'processing', label: 'Ordren er Behandles' },
                  { value: 'completed', label: 'Ordren er Gennemført' },
                ]}
              />
            )}
          </Field>
          <Field
            label="EU B2B-salg"
            error="Kontoen 1010 findes ikke længere i Dinero. Vælg en ny konto for EU-salg."
          >
            {({ id, describedBy, invalid }) => (
              <Combobox
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={account}
                onChange={setAccount}
                options={ACCOUNTS}
                placeholder="Vælg konto"
                searchPlaceholder="Søg i kontoplanen"
                emptyText="Ingen konti matcher"
                missingText="Findes ikke længere"
              />
            )}
          </Field>
          <Field label="Deaktiveret">
            {({ id }) => <Input id={id} disabled defaultValue="Kan ikke ændres" />}
          </Field>
          <Field label="Låst">{() => <LockedValue>Styres af planen</LockedValue>}</Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-table font-medium">Søgefelt</span>
            <SearchInput placeholder="Søg i flows" aria-label="Søg i flows" />
          </div>
        </div>
        <Advanced label={t('common.advanced')} open={advanced} onOpenChange={setAdvanced}>
          <Field label="Idempotensnøgle" inline>
            {({ id }) => (
              <Input id={id} density="compact" mono defaultValue="order.id + order.updated_at" />
            )}
          </Field>
        </Advanced>
      </Section>

      <Section
        id="table"
        title="DataTable"
        meta="Header 40 · række 44 · underrække 36 · valgt = lime kant"
      >
        <Table>
          <thead>
            <tr>
              <Th className="w-8" />
              <Th>Flow</Th>
              <Th>Forbindelser</Th>
              <Th>Status</Th>
              <Th>Tilstand</Th>
              <Th numeric>Records 7 dage</Th>
              <Th>Sidst kørt</Th>
              <Th className="w-36" />
            </tr>
          </thead>
          <tbody>
            <Tr interactive selected>
              <Td>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-expanded={expanded}
                  aria-label={expanded ? 'Fold sammen' : 'Fold ud'}
                  onClick={() => setExpanded((e) => !e)}
                >
                  <Icon icon={expanded ? ChevronDown : ChevronRight} size={16} />
                </Button>
              </Td>
              <Td className="font-semibold">
                Webshop → regnskab og CRM <span className="font-normal text-fg-2">· 5 ruter</span>
              </Td>
              <Td>
                <ConnectorPair source={WOO} destinations={[DINERO, HUBSPOT, BREVO]} size={24} />
              </Td>
              <Td>
                <StatusPill status="error">
                  {t('status.since', { status: t('status.error'), time: '13:51' })}
                </StatusPill>
              </Td>
              <Td className="text-fg-2">Blandet</Td>
              <Td numeric>1.284</Td>
              <Td className="text-fg-2">for 4 min. siden</Td>
              <Td>
                <RowActions>
                  <Button size="s" variant="secondary" icon={RotateCcw}>
                    Gentag 2
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.moreActions')}
                    className="size-7"
                  >
                    <Icon icon={Ellipsis} size={16} />
                  </Button>
                </RowActions>
              </Td>
            </Tr>
            {expanded &&
              [
                ['Ordrer → Dinero Fakturaer', 'ok', 'live'],
                ['Kreditnotaer → Dinero Kreditnotaer', 'error', 'live'],
                ['Kunder → HubSpot Kontakter', 'info', 'test'],
              ].map(([name, s, m]) => (
                <Tr key={name} sub interactive>
                  <Td sub />
                  <Td sub className="pl-10">
                    {name}
                  </Td>
                  <Td sub />
                  <Td sub>
                    <StatusPill status={s as 'ok'} compact>
                      {t(`status.${s as 'ok'}`)}
                    </StatusPill>
                  </Td>
                  <Td sub>
                    <ModeBadge mode={m as 'live'}>{t(`mode.${m as 'live'}`)}</ModeBadge>
                  </Td>
                  <Td sub numeric>
                    412
                  </Td>
                  <Td sub className="text-fg-2">
                    for 4 min. siden
                  </Td>
                  <Td sub />
                </Tr>
              ))}
          </tbody>
        </Table>
      </Section>

      <div className="grid grid-cols-2 gap-6">
        <Section id="feedback" title="Dialog, toast og banner">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog(true)}>
              Åbn dialog
            </Button>
            <Button variant="destructive" icon={Trash2} onClick={() => setDestructive(true)}>
              {t('dev.deleteFlow')}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                toast.ok({
                  title: 'Flowet er pauset',
                  description: 'Webshop → regnskab og CRM',
                  action: { label: t('common.undo'), onClick: () => undefined },
                  closeLabel: close,
                })
              }
            >
              Vis toast
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                toast.error({
                  title: 'Kunne ikke gemme',
                  description: 'Prøv igen om lidt.',
                  closeLabel: close,
                })
              }
            >
              Vis fejl-toast
            </Button>
          </div>
          <Banner tone="warn" title="2 records sprunget over">
            Ordrerne mangler et land. Ret dem i WooCommerce, og kør igen.
          </Banner>
          <Banner
            tone="error"
            title="Dinero-forbindelsen er afbrudt"
            action={
              <Button size="s" variant="dark">
                {t('dev.reauth')}
              </Button>
            }
          >
            Nye ordrer venter i kø.
          </Banner>
          <Banner tone="info" onDismiss={() => undefined} dismissLabel={close}>
            Mette redigerer dette flow · Åbnet skrivebeskyttet
          </Banner>
          <Banner tone="navy" global>
            Planlagt vedligehold søndag kl. 06–07.
          </Banner>
        </Section>
        <Section id="states" title="Tom, indlæser og fejl">
          <EmptyState
            icon={Workflow}
            title="Ingen flows endnu"
            action={
              <Button variant="primary" icon={Plus}>
                {t('dev.newFlow')}
              </Button>
            }
          >
            Start fra en skabelon, så er du i gang på få minutter.
          </EmptyState>
          <Loading label={t('common.loading')}>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-11 w-full" />
            </div>
          </Loading>
          <LoadError
            message={t('common.loadError')}
            retryLabel={t('common.retry')}
            onRetry={() => undefined}
          />
        </Section>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <ErrorCard
          title="Ordre #10447 kunne ikke bogføres"
          why="Kontoen 1010 Salg EU findes ikke længere i Dinero."
          stepsTitle="Sådan løser du det"
          steps={['Vælg en ny konto for EU-salg under Mapping.', 'Gentag ordren.']}
          actions={
            <>
              <Button size="s" variant="primary">
                {t('dev.fixAccount')}
              </Button>
              <Button size="s" variant="secondary" icon={RotateCcw}>
                Gentag
              </Button>
            </>
          }
          details={{
            label: 'Tekniske detaljer',
            code: 'DINERO_ACCOUNT_NOT_FOUND',
            blocks: [
              {
                title: 'Request',
                body: 'POST /v1/412983/invoices\nAuthorization: Bearer ••••',
                copyLabel: t('common.copy'),
                copiedLabel: t('common.copied'),
              },
            ],
          }}
        />
        <Card className="flex flex-col gap-5">
          <CardHeader title="Forbrug" meta="Nulstilles 1. nov." />
          <UsageMeter label="Transaktioner" valueText="712 / 1.000" used={712} limit={1000} />
          <UsageMeter
            label="Transaktioner"
            valueText="890 / 1.000"
            used={890}
            limit={1000}
            warnText="89 % brugt · overvej at opgradere"
          />
          <div className="rounded-node bg-navy p-4 on-navy">
            <UsageMeter tone="navy" label="Integrationssæt" valueText="2 / 2" used={2} limit={2} />
          </div>
          <KeyValueList
            items={[
              { label: 'Konto-id', value: <span className="font-mono text-mono">412983</span> },
              { label: 'Forbundet af', value: 'Mette Holm · 2. sep.' },
              { label: 'Rate limit', value: 'Deles af alle flows' },
            ]}
          />
          <div className="flex items-center gap-3">
            <Avatar name="Mette Holm" />
            <Avatar name="Jonas Krag" size={32} tone="navy" />
            <Avatar name="Agentor Support" size={40} tone="support" />
          </div>
        </Card>
      </div>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Sæt flowet på pause?"
        description="Nye ordrer venter, til du genoptager flowet."
        closeLabel={close}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Sæt på pause
            </Button>
          </>
        }
      />
      <DestructiveDialog
        open={destructive}
        onOpenChange={setDestructive}
        title="Slet flowet „Lager retur“?"
        consequences={[
          'Nye kørsler stopper straks.',
          'Historik bevares i 30 dage og slettes derefter.',
        ]}
        confirmName="Lager retur"
        typeLabel="Skriv flowets navn for at bekræfte"
        confirmLabel={t('dev.deleteFlow')}
        cancelLabel={t('common.cancel')}
        closeLabel={close}
        onConfirm={() => setDestructive(false)}
      />
    </main>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-meta font-medium text-fg-2">{label}</span>
      {Children.map(children, (c) => (
        <div className="flex items-center gap-2">{c}</div>
      ))}
    </>
  );
}
