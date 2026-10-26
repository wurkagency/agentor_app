'use client';

import { toast } from '@agentor/ui';
import {
  BigButton,
  CardActions,
  CardButton,
  MobileCard,
  MobileField,
  Modal,
  RowIcon,
  Switch,
  TopBarAction,
  type RowTone,
} from '@agentor/ui/mobile';
import {
  ChevronRight,
  CreditCard,
  Ellipsis,
  ExternalLink,
  Kanban,
  LockKeyhole,
  PenLine,
  Plus,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import {
  addCustomerNoteAction,
  endAccessAction,
  openAsSuperadminAction,
  openSupportViewAction,
  requestExtensionAction,
} from '@/app/platform/actions';
import { MobileTextarea } from '@/components/mobile/native-select';
import { NewCaseDialog } from '@/components/platform/new-case-dialog';
import type { AccessTarget } from '@/components/platform/request-access-dialog';
import { RequestAccessSheet } from '@/components/platform/request-access-sheet';

export type MobileGrant =
  | { kind: 'active'; grantId: string; until: string }
  | { kind: 'pending' }
  | { kind: 'direct' }
  | { kind: 'none' };

export interface MobileCustomer {
  tenantId: string;
  name: string;
  /** "Business · CVR 12345678" under the sheet title (MP17). */
  meta: string;
  grant: MobileGrant;
  target: AccessTarget;
  /** Superadmin only: the customer's finance page (MP20). */
  financeHref: string | null;
}

type Sheet = 'actions' | 'request' | 'note' | 'newCase' | null;

const SheetContext = createContext<(s: Sheet) => void>(() => undefined);

/**
 * MP08's sheets in one place: MP17 Handlinger, MP09 Anmod om adgang, Ny note and Ny sag. The
 * buttons that open them sit in the top bar and in the access callout.
 */
export function CustomerSheets({
  customer,
  openRequest = false,
  children,
}: {
  customer: MobileCustomer;
  /** `?request=1` from MP11 "Anmod": opens MP09 straight away. */
  openRequest?: boolean;
  children: ReactNode;
}) {
  const [sheet, setSheet] = useState<Sheet>(
    openRequest && customer.grant.kind === 'none' ? 'request' : null,
  );
  const close = () => setSheet(null);
  return (
    <SheetContext.Provider value={setSheet}>
      {children}
      {sheet === 'actions' && (
        <ActionsSheet customer={customer} onOpen={setSheet} onClose={close} />
      )}
      {sheet === 'request' && <RequestAccessSheet target={customer.target} onClose={close} />}
      {sheet === 'note' && <NoteSheet tenantId={customer.tenantId} onClose={close} />}
      {sheet === 'newCase' && (
        <NewCaseDialog
          customers={[{ id: customer.tenantId, name: customer.name }]}
          defaultTenantId={customer.tenantId}
          onClose={close}
        />
      )}
    </SheetContext.Provider>
  );
}

/** "Ny note" and the customer's actions (MP17) in the navy top bar. */
export function CustomerTopActions({ name }: { name: string }) {
  const t = useTranslations('platform.customer');
  const tm = useTranslations('mobile.customer');
  const open = useContext(SheetContext);
  return (
    <>
      <TopBarAction icon={PenLine} label={t('newNote')} onNavy onClick={() => open('note')} />
      <TopBarAction
        icon={Ellipsis}
        label={tm('actions', { name })}
        onNavy
        onClick={() => open('actions')}
      />
    </>
  );
}

function useOpenApp(grant: MobileGrant, tenantId: string) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      if (grant.kind === 'active') await openSupportViewAction(grant.grantId);
      else if (grant.kind === 'direct') await openAsSuperadminAction(tenantId);
    });
  return [pending, run] as const;
}

/** The access callout's buttons: "Åbn kundens app" + "Afslut adgang", or "Anmod om adgang". */
export function GrantButtons({ customer }: { customer: MobileCustomer }) {
  const t = useTranslations('platform.customer');
  const tr = useTranslations('platform.customers');
  const tc = useTranslations('common');
  const router = useRouter();
  const open = useContext(SheetContext);
  const [opening, openApp] = useOpenApp(customer.grant, customer.tenantId);
  const [ending, start] = useTransition();
  const g = customer.grant;
  if (g.kind === 'pending') return null;
  if (g.kind === 'none')
    return (
      <CardActions>
        <CardButton variant="dark" icon={Plus} onClick={() => open('request')}>
          {tr('requestAccess')}
        </CardButton>
      </CardActions>
    );
  return (
    <CardActions>
      <CardButton variant="dark" icon={ExternalLink} disabled={opening} onClick={openApp}>
        {t('openApp')}
      </CardButton>
      {g.kind === 'active' && (
        <CardButton
          disabled={ending}
          onClick={() =>
            start(async () => {
              const res = await endAccessAction(customer.tenantId, g.grantId);
              if (!res.ok) return;
              toast.ok({ title: t('accessEnded'), closeLabel: tc('close') });
              router.refresh();
            })
          }
        >
          {t('endAccess')}
        </CardButton>
      )}
    </CardActions>
  );
}

const ROW =
  'flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-left font-sans text-fg-1 no-underline shadow-row-divider last:shadow-none hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-60';

function ActionBody({
  icon,
  tone = 'neutral',
  title,
  meta,
  chevron = true,
}: {
  icon: LucideIcon;
  tone?: RowTone;
  title: string;
  meta: string;
  chevron?: boolean;
}) {
  return (
    <>
      <RowIcon icon={icon} tone={tone} />
      <span className="flex min-w-0 flex-1 flex-col py-2.5 leading-snug">
        <strong className="truncate text-body font-semibold">{title}</strong>
        <span className="truncate text-meta font-medium text-fg-2">{meta}</span>
      </span>
      {chevron && (
        <ChevronRight aria-hidden width={18} height={18} className="flex-none text-fg-2" />
      )}
    </>
  );
}

/** MP17 Handlinger for en kunde (P1 menu): open as support, request, new case, finance, access. */
function ActionsSheet({
  customer,
  onOpen,
  onClose,
}: {
  customer: MobileCustomer;
  onOpen: (s: Sheet) => void;
  onClose: () => void;
}) {
  const t = useTranslations('mobile.customerActions');
  const tp = useTranslations('platform.customer');
  const tc = useTranslations('common');
  const router = useRouter();
  const g = customer.grant;
  const [opening, openApp] = useOpenApp(g, customer.tenantId);
  const [busy, start] = useTransition();
  const extend = (grantId: string) =>
    start(async () => {
      const res = await requestExtensionAction(customer.tenantId, grantId);
      if (!res.ok) return;
      onClose();
      toast.ok({ title: tp('extensionSent'), closeLabel: tc('close') });
    });
  const end = (grantId: string) =>
    start(async () => {
      const res = await endAccessAction(customer.tenantId, grantId);
      if (!res.ok) return;
      onClose();
      toast.ok({ title: tp('accessEnded'), closeLabel: tc('close') });
      router.refresh();
    });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={customer.name}
      description={customer.meta}
      closeLabel={tc('close')}
    >
      <MobileCard>
        {g.kind === 'active' || g.kind === 'direct' ? (
          <button type="button" className={ROW} disabled={opening} onClick={openApp}>
            <ActionBody
              icon={ExternalLink}
              title={t('openSupport')}
              meta={g.kind === 'active' ? t('accessUntil', { when: g.until }) : t('direct')}
            />
          </button>
        ) : g.kind === 'pending' ? (
          <div className={ROW}>
            <ActionBody icon={Timer} title={t('pending')} meta={t('pendingMeta')} chevron={false} />
          </div>
        ) : (
          <button type="button" className={ROW} onClick={() => onOpen('request')}>
            <ActionBody icon={Plus} title={t('request')} meta={t('requestMeta')} />
          </button>
        )}
        <button type="button" className={ROW} onClick={() => onOpen('newCase')}>
          <ActionBody icon={Kanban} title={t('newCase')} meta={t('newCaseMeta')} />
        </button>
        {customer.financeHref && (
          <Link href={customer.financeHref} className={ROW}>
            <ActionBody icon={CreditCard} title={t('finance')} meta={t('financeMeta')} />
          </Link>
        )}
      </MobileCard>
      {g.kind === 'active' && (
        <MobileCard>
          <button type="button" className={ROW} disabled={busy} onClick={() => extend(g.grantId)}>
            <ActionBody icon={Timer} title={t('extend')} meta={t('extendMeta')} />
          </button>
          <button type="button" className={ROW} disabled={busy} onClick={() => end(g.grantId)}>
            <ActionBody icon={LockKeyhole} tone="error" title={t('end')} meta={t('endMeta')} />
          </button>
        </MobileCard>
      )}
    </Modal>
  );
}

/** "Ny note" (P2) as a mobile sheet: staff only, optionally pinned on the customer's cases. */
function NoteSheet({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const t = useTranslations('platform.customer');
  const tc = useTranslations('common');
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(true);
  const [pending, start] = useTransition();
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('newNote')}
      description={t('noteHelp')}
      closeLabel={tc('close')}
      footer={
        <div className="grid w-full grid-cols-m-actions gap-2">
          <BigButton variant="secondary" onClick={onClose}>
            {t('cancel')}
          </BigButton>
          <BigButton
            loading={pending}
            disabled={!body.trim()}
            onClick={() =>
              start(async () => {
                const res = await addCustomerNoteAction(tenantId, body, pinned);
                if (!res.ok) return;
                onClose();
                router.refresh();
              })
            }
          >
            {t('saveNote')}
          </BigButton>
        </div>
      }
    >
      <MobileField label={t('note')}>
        <MobileTextarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </MobileField>
      <div className="flex items-center justify-between gap-3">
        <strong className="text-body">{t('pin')}</strong>
        <Switch checked={pinned} onCheckedChange={setPinned} label={t('pin')} />
      </div>
    </Modal>
  );
}
