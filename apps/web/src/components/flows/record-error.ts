/**
 * Customer-facing explanation of a failed record (D8-Kørsler-Forretning): what happened, why, and
 * how to fix it, built from the engine's error code and parameters. No technical wording here;
 * the raw details live in the developer view.
 */
export interface RecordErrorInput {
  errorCode: string | null;
  errorParams: Record<string, string> | null;
  label: string;
  entity: string;
  customer?: string | null;
  country?: string | null;
  system: string;
  /** The mapping field's label from the manifest ("EU B2B-salg"). */
  fieldLabel?: string | null;
}

export function explain(t: (k: string, p?: Record<string, string>) => string, e: RecordErrorInput) {
  const p = e.errorParams ?? {};
  const field = e.fieldLabel ?? p.field ?? '';
  const what = t(
    `what.${e.entity === 'creditNote' ? 'creditNote' : e.entity === 'order' ? 'order' : 'record'}`,
    {
      label: e.label,
      system: e.system,
    },
  );
  switch (e.errorCode) {
    case 'ACCOUNT_NOT_FOUND':
      return {
        what,
        why: t('why.accountNotFound', {
          value: p.value ?? '',
          system: e.system,
          field,
          country: e.country ?? '',
        }),
        steps: [t('fix.openMapping'), t('fix.chooseAccount', { field }), t('fix.publishRetry')],
        short: t('short.accountNotFound', { value: p.value ?? '', system: e.system }),
        mappingField: p.field ?? null,
      };
    case 'ACCOUNT_MISSING':
      return {
        what,
        why: t('why.accountMissing', { field, system: e.system }),
        steps: [t('fix.openMapping'), t('fix.chooseAccount', { field }), t('fix.publishRetry')],
        short: t('short.accountMissing'),
        mappingField: p.field ?? null,
      };
    case 'INVOICE_MISSING':
      return {
        what,
        why: t('why.invoiceMissing', { order: p.order ?? e.label, system: e.system }),
        steps: [t('fix.bookInvoice', { system: e.system }), t('fix.retryLater')],
        short: t('short.invoiceMissing'),
        mappingField: null,
      };
    case 'CONNECTION_BROKEN':
      return {
        what,
        why: t('why.connectionBroken', { connector: p.connector ?? e.system }),
        steps: [t('fix.reconnect', { connector: p.connector ?? e.system })],
        short: t('short.waiting'),
        mappingField: null,
      };
    default:
      return {
        what,
        why: t('why.generic', { system: e.system }),
        steps: [t('fix.retryLater')],
        short: t('short.generic'),
        mappingField: null,
      };
  }
}
