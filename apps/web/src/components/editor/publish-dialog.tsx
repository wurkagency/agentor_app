'use client';

import { diffDefinitions, type FlowDefinition } from '@agentor/flows';
import {
  Banner,
  Button,
  Checkbox,
  Dialog,
  Icon,
  ModeBadge,
  RadioGroup,
  RadioCard,
} from '@agentor/ui';
import { ArrowRight, Info, PencilLine, Plus, Radio } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { describeChanges, erpOrderRoutes, nodeManifest, type ConnMap } from './model';

/**
 * Publicér (D5-GaaLive): what changes since the published version, how invoices are created in
 * the ERP (as drafts or booked), an explicit confirmation when anything writes to an ERP, and
 * an offer to retry what failed on the previous version.
 */
export function PublishDialog({
  open,
  onOpenChange,
  flowName,
  nextVersion,
  published,
  draft,
  conns,
  lookups,
  testedClean,
  openFailures,
  busy,
  error,
  onPublish,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  flowName: string;
  nextVersion: number;
  published: { number: number; definition: FlowDefinition } | null;
  draft: FlowDefinition;
  conns: ConnMap;
  lookups: Record<string, Partial<Record<string, { value: string; label: string }[]>>>;
  testedClean: boolean | null;
  openFailures: number;
  busy: boolean;
  error: string | null;
  onPublish: (opts: { invoiceMode: 'draft' | 'live' | null; retry: boolean }) => void;
}) {
  const t = useTranslations('editor');
  const tm = useTranslations('mode');
  const erp = erpOrderRoutes(draft, conns);
  const erpName = erp[0] ? nodeManifest(draft, conns, erp[0].to)?.name : null;
  const [invoiceMode, setInvoiceMode] = useState<'draft' | 'live'>(
    erp.some((r) => r.mode === 'live') ? 'live' : 'draft',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [retry, setRetry] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // The invoice choice applies to every order route into the ERP that isn't in Test.
  const effective = useMemo(() => {
    const d = structuredClone(draft);
    for (const r of d.routes)
      if (erp.some((x) => x.id === r.id) && r.mode !== 'test') r.mode = invoiceMode;
    return d;
  }, [draft, erp, invoiceMode]);
  const changes = diffDefinitions(published?.definition ?? null, effective);
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
    (k, p) => t(k, p),
    published?.definition ?? null,
    effective,
    changes,
    conns,
    lookupLabel,
  );
  const writesErp = erp.some((r) => r.mode !== 'test');
  const canPublish = !busy && (!writesErp || confirmed);
  const shown = showAll ? lines : lines.slice(0, 4);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={720}
      title={t('publish.title', { n: nextVersion })}
      description={[
        flowName,
        published
          ? t('publish.changesSince', { count: lines.length, n: published.number })
          : t('publish.first'),
        testedClean === null
          ? t('publish.notTested')
          : testedClean
            ? t('publish.testedClean')
            : t('publish.testedErrors'),
      ].join(' · ')}
      closeLabel={t('close')}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {lines.length > 4 ? (
            <Button variant="ghost" size="m" onClick={() => setShowAll(!showAll)}>
              {showAll ? t('publish.fewer') : t('publish.all')}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="secondary" size="m" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              size="m"
              loading={busy}
              disabled={!canPublish}
              onClick={() =>
                onPublish({
                  invoiceMode: erp.length ? invoiceMode : null,
                  retry: retry && openFailures > 0,
                })
              }
            >
              {writesErp && invoiceMode === 'draft' ? t('publish.asDraft') : t('publish.publish')}
            </Button>
          </span>
        </div>
      }
    >
      {error && (
        <Banner tone="error">
          {t(`publish.errors.${error === 'VALIDATION' || error === 'LOCKED' ? error : 'generic'}`)}
        </Banner>
      )}
      <ul className="m-0 flex list-none flex-col p-0" aria-label={t('publish.changes')}>
        {lines.length === 0 && (
          <li className="py-2 text-table text-fg-2">{t('publish.noChanges')}</li>
        )}
        {shown.map((l, i) => (
          <li
            key={`${l.routeId}-${i}`}
            className="flex items-start gap-3 border-t border-border py-3 first:border-0"
          >
            <span className="grid size-7 flex-none place-items-center rounded-full bg-bg-base">
              <Icon
                icon={
                  l.modeTo === 'live' ? Radio : l.detail === t('change.added') ? Plus : PencilLine
                }
                size={14}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-table font-semibold">{l.title}</span>
              <span className="text-meta text-fg-2">{l.detail}</span>
            </div>
            {l.modeFrom && l.modeTo ? (
              <span className="flex items-center gap-1.5">
                <ModeBadge mode={l.modeFrom as 'test'}>{tm(l.modeFrom)}</ModeBadge>
                <Icon icon={ArrowRight} size={14} className="text-fg-2" />
                <ModeBadge mode={l.modeTo as 'live'}>{tm(l.modeTo)}</ModeBadge>
              </span>
            ) : (
              <ModeBadge mode="draft">{t('publish.inDraft')}</ModeBadge>
            )}
          </li>
        ))}
      </ul>
      {openFailures > 0 && (
        <div className="flex items-start gap-3 rounded-sm bg-bg-base px-4 py-3 text-table">
          <Icon icon={Info} size={16} className="mt-0.5 text-info-fg" />
          <label className="flex flex-1 items-start gap-2.5">
            <Checkbox
              checked={retry}
              onCheckedChange={(v) => setRetry(v === true)}
              aria-label={t('publish.retry', { count: openFailures })}
            />
            <span>{t('publish.retry', { count: openFailures })}</span>
          </label>
        </div>
      )}
      {erp.length > 0 && erp.some((r) => r.mode !== 'test') && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-body font-semibold">
            {t('publish.howInvoices', { system: erpName ?? '' })}
          </legend>
          <RadioGroup
            value={invoiceMode}
            onValueChange={(v) => setInvoiceMode(v as 'draft' | 'live')}
            className="grid grid-cols-2 gap-3"
            aria-label={t('publish.howInvoices', { system: erpName ?? '' })}
          >
            <RadioCard
              value="draft"
              title={t('publish.draftTitle')}
              description={t('publish.draftBody', { system: erpName ?? '' })}
            />
            <RadioCard
              value="live"
              title={t('publish.liveTitle')}
              description={t('publish.liveBody')}
            />
          </RadioGroup>
        </fieldset>
      )}
      {writesErp && (
        <label className="flex items-start gap-2.5">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
            aria-describedby="confirm-help"
          />
          <span className="flex flex-col">
            <span className="text-body font-semibold">
              {t('publish.confirm', { system: erpName ?? '' })}
            </span>
            <span id="confirm-help" className="text-meta text-fg-2">
              {invoiceMode === 'draft'
                ? t('publish.confirmDraftHelp', { system: erpName ?? '' })
                : t('publish.confirmLiveHelp')}
            </span>
          </span>
        </label>
      )}
    </Dialog>
  );
}
