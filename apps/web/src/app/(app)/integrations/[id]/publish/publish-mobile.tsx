'use client';

import { manifestFor } from '@agentor/connectors';
import { diffDefinitions, type FlowDefinition } from '@agentor/flows';
import { formatRelative, type Locale } from '@agentor/i18n';
import { cn, ModeBadge, toast } from '@agentor/ui';
import {
  BigButton,
  DeskNote,
  MobileCallout,
  MobileCard,
  MobileCheckbox,
  MobileShell,
  Modal,
  Row,
} from '@agentor/ui/mobile';
import { CircleX } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { publishAction } from '../editor/actions';
import {
  describeChanges,
  erpOrderRoutes,
  nodeManifest,
  type ConnMap,
} from '@/components/editor/model';
import { AppTopBar } from '@/components/mobile/chrome';

type Lookups = Record<string, Partial<Record<string, { value: string; label: string }[]>>>;

/**
 * MA23: "Publicér vN" as a sheet over the flow. The logic is the editor's PublishDialog: the
 * invoice choice applies to every order route into the ERP that isn't in Test, writing to an
 * ERP needs the confirmation, and failed records can be retried on the new version.
 */
export function PublishMobile({
  flow,
  draft,
  published,
  conns,
  lookups,
  openFailures,
  tested,
  canEdit,
}: {
  flow: { id: string; name: string };
  draft: { id: string; definition: FlowDefinition } | null;
  published: { number: number; definition: FlowDefinition } | null;
  conns: ConnMap;
  lookups: Lookups;
  openFailures: number;
  tested: { clean: boolean; at: string } | null;
  canEdit: boolean;
}) {
  const t = useTranslations('mobile.publish');
  const te = useTranslations('editor');
  const tf = useTranslations('mobile.flow');
  const router = useRouter();
  const back = `/integrations/${flow.id}?tab=routes`;
  const nextVersion = (published?.number ?? 0) + 1;
  const title = tf('publish', { n: nextVersion });
  const topBar = <AppTopBar back={back} title={flow.name} />;

  if (!canEdit || !draft)
    return (
      <MobileShell topBar={topBar}>
        <DeskNote>{canEdit ? t('noDraft') : t('readOnly')}</DeskNote>
      </MobileShell>
    );
  return (
    <PublishSheet
      {...{ flow, draft, published, conns, lookups, openFailures, tested, back, title, topBar }}
      onDone={(version, retried) => {
        toast.ok({
          title: te('published', { n: version }),
          ...(retried ? { description: te('retrying') } : {}),
          closeLabel: te('close'),
        });
        router.push(`/integrations/${flow.id}`);
        router.refresh();
      }}
      onClose={() => router.push(back)}
    />
  );
}

function PublishSheet({
  flow,
  draft,
  published,
  conns,
  lookups,
  openFailures,
  tested,
  title,
  topBar,
  onDone,
  onClose,
}: {
  flow: { id: string; name: string };
  draft: { id: string; definition: FlowDefinition };
  published: { number: number; definition: FlowDefinition } | null;
  conns: ConnMap;
  lookups: Lookups;
  openFailures: number;
  tested: { clean: boolean; at: string } | null;
  back: string;
  title: string;
  topBar: ReactNode;
  onDone: (version: number, retried: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations('mobile.publish');
  const te = useTranslations('editor');
  const tm = useTranslations('mode');
  const locale = useLocale() as Locale;
  const def = draft.definition;
  const erp = erpOrderRoutes(def, conns);
  const erpName = (erp[0] ? nodeManifest(def, conns, erp[0].to)?.name : null) ?? '';
  const [invoiceMode, setInvoiceMode] = useState<'draft' | 'live'>(
    erp.some((r) => r.mode === 'live') ? 'live' : 'draft',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [retry, setRetry] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effective = useMemo(() => {
    const d = structuredClone(def);
    for (const r of d.routes)
      if (erp.some((x) => x.id === r.id) && r.mode !== 'test') r.mode = invoiceMode;
    return d;
  }, [def, erp, invoiceMode]);
  const lookupLabel = (routeId: string, value: string | null) => {
    if (!value) return '–';
    const r = effective.routes.find((x) => x.id === routeId);
    const node = r ? effective.nodes.find((n) => n.id === r.to) : undefined;
    const label = node
      ? lookups[node.connectionId]?.accounts?.find((a) => a.value === value)?.label
      : undefined;
    return label ? `${value} ${label}` : value;
  };
  const lines = describeChanges(
    (k, p) => te(k, p),
    published?.definition ?? null,
    effective,
    diffDefinitions(published?.definition ?? null, effective),
    conns,
    lookupLabel,
  );
  const writesErp = erp.some((r) => r.mode !== 'test');
  const canPublish = !busy && (!writesErp || confirmed);

  const publish = async () => {
    // As the editor: the choice is written into the definition that gets published.
    const d = structuredClone(def);
    if (erp.length)
      for (const r of d.routes)
        if (r.entity === 'order' && r.targetEntity === 'order' && r.mode !== 'test') {
          const node = d.nodes.find((n) => n.id === r.to);
          const m = node ? manifestFor(conns[node.connectionId]?.connectorId ?? '') : null;
          if (m?.category === 'erp') r.mode = invoiceMode;
        }
    setBusy(true);
    setError(null);
    const res = await publishAction(flow.id, draft.id, d, {
      retryFailures: retry && openFailures > 0,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'generic');
      return;
    }
    onDone(res.data!.version, res.data!.retried);
  };

  const testedText =
    tested === null
      ? te('publish.notTested')
      : tested.clean
        ? te('publish.testedClean')
        : te('publish.testedErrors');

  return (
    <MobileShell topBar={topBar}>
      <MobileCard>
        <Row
          title={flow.name}
          meta={
            tested
              ? t('testedAgo', { when: formatRelative(new Date(tested.at), new Date(), locale) })
              : testedText
          }
        />
      </MobileCard>
      <Modal
        open
        onOpenChange={(o) => {
          if (!o && !busy) onClose();
        }}
        title={title}
        description={[
          flow.name,
          published
            ? te('publish.changesSince', { count: lines.length, n: published.number })
            : te('publish.first'),
          testedText,
        ].join(' · ')}
        closeLabel={te('close')}
        className="bg-canvas"
        footer={
          <BigButton loading={busy} disabled={!canPublish} onClick={() => void publish()}>
            {writesErp && invoiceMode === 'draft' ? te('publish.asDraft') : te('publish.publish')}
          </BigButton>
        }
      >
        {error && (
          <MobileCallout tone="error" icon={CircleX} title={te('publish.publish')}>
            {te(
              `publish.errors.${error === 'VALIDATION' || error === 'LOCKED' ? error : 'generic'}`,
            )}
          </MobileCallout>
        )}
        <MobileCard label={te('publish.changes')}>
          {lines.length === 0 ? (
            <p className="m-0 px-3.5 py-3 text-table text-fg-2">{te('publish.noChanges')}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {lines.map((l, i) => (
                <li
                  key={`${l.routeId}-${i}`}
                  className="flex items-start gap-3 px-3.5 py-2.5 shadow-row-divider last:shadow-none"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug">
                    <strong className="text-table">{l.title}</strong>
                    <span className="text-meta font-medium text-fg-2">{l.detail}</span>
                  </span>
                  {l.modeTo ? (
                    <ModeBadge mode={l.modeTo as 'live'}>{tm(l.modeTo as 'live')}</ModeBadge>
                  ) : (
                    <ModeBadge mode="draft">{t('draftBadge')}</ModeBadge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </MobileCard>

        {writesErp && (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-table font-bold">
              {t('howInvoices', { system: erpName })}
            </legend>
            {(['draft', 'live'] as const).map((k) => (
              <label
                key={k}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md bg-surface px-3.5 py-3 shadow-sm outline-offset-2 has-focus-visible:outline-2 has-focus-visible:outline-fg-1',
                  invoiceMode === k && 'shadow-ring-dark-2',
                )}
              >
                <input
                  type="radio"
                  name="invoice-mode"
                  value={k}
                  checked={invoiceMode === k}
                  onChange={() => setInvoiceMode(k)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    'size-5.5 flex-none rounded-full',
                    invoiceMode === k ? 'shadow-radio-on-lg' : 'shadow-ring-strong-2',
                  )}
                />
                <span className="flex flex-col gap-0.5 leading-snug">
                  <strong className="text-body">
                    {k === 'draft' ? t('draftTitle') : t('liveTitle')}
                  </strong>
                  <span className="text-meta font-medium text-fg-2">
                    {k === 'draft' ? t('draftBody', { system: erpName }) : t('liveBody')}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {openFailures > 0 && (
          <div className="-ml-3 flex items-center gap-1 text-table">
            <MobileCheckbox
              checked={retry}
              onCheckedChange={setRetry}
              label={te('publish.retry', { count: openFailures })}
            />
            <span aria-hidden>{te('publish.retry', { count: openFailures })}</span>
          </div>
        )}
        {writesErp && (
          <div className="-ml-3 flex items-start gap-1 text-table">
            <MobileCheckbox
              checked={confirmed}
              onCheckedChange={setConfirmed}
              label={
                invoiceMode === 'draft'
                  ? t('confirmDraft', { system: erpName })
                  : t('confirmLive', { system: erpName })
              }
            />
            <span aria-hidden className="pt-2.5">
              {invoiceMode === 'draft'
                ? t('confirmDraft', { system: erpName })
                : t('confirmLive', { system: erpName })}
            </span>
          </div>
        )}
      </Modal>
    </MobileShell>
  );
}
