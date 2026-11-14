'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  cn,
  toast,
} from '@agentor/ui';
import { Check, ChevronDown, Download, FileText, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { sendReportAction } from '@/app/platform/finance/actions';

export interface MenuLink {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

/**
 * Administration › Rapporter: the report type, the period and "Eksport" (PDF, CSV, Send til
 * bogholder) as three dropdowns. Type and period are links, so the choice lives in the URL
 * (?from=&to=) and the exports are logged on the server as before.
 */
export function ReportMenus({
  types,
  periods,
  pdfHref,
  csvHref,
  sendMonth,
  mobile = false,
  only,
}: {
  types: MenuLink[];
  periods: MenuLink[];
  pdfHref: string;
  csvHref: string;
  /** The month the bookkeeper gets (YYYY-MM) and its name, or null when there is none. */
  sendMonth: { key: string; name: string } | null;
  mobile?: boolean;
  /** On the phone the type and period sit at the top and Eksport in the bar at the bottom. */
  only?: 'pickers' | 'export';
}) {
  const t = useTranslations('platform.reports');
  const ta = useTranslations('platform.finance.actions');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const trigger = (label: string, aria: string) => (
    <DropdownMenuTrigger asChild>
      <Button
        variant="secondary"
        size={mobile ? 'l' : 'm'}
        aria-label={aria}
        className={cn(mobile && 'h-12 w-full justify-between normal-case tracking-normal')}
      >
        <span className="truncate">{label}</span>
        <Icon icon={ChevronDown} size={16} />
      </Button>
    </DropdownMenuTrigger>
  );
  const linkMenu = (items: MenuLink[], aria: string) => {
    const active = items.find((i) => i.active) ?? items[0]!;
    return (
      <DropdownMenu>
        {trigger(active.label, `${aria}: ${active.label}`)}
        <DropdownMenuContent align={mobile ? 'start' : 'end'} className="min-w-56 p-1.5">
          {items.map((i) => (
            <DropdownMenuItem
              key={i.key}
              onSelect={() => router.push(i.href)}
              icon={<Icon icon={Check} size={16} className={i.active ? '' : 'invisible'} />}
              {...(i.active ? { 'aria-current': 'true' } : {})}
            >
              {i.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const exportMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="primary"
          size={mobile ? 'l' : 'm'}
          loading={pending}
          className={cn(mobile && 'h-12 w-full justify-between normal-case tracking-normal')}
        >
          {t('export')}
          <Icon icon={ChevronDown} size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64 p-1.5">
        <DropdownMenuItem
          icon={<Icon icon={FileText} size={16} />}
          onSelect={() => window.location.assign(pdfHref)}
        >
          {t('pdf')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Icon icon={Download} size={16} />}
          onSelect={() => window.location.assign(csvHref)}
        >
          {t('csv')}
        </DropdownMenuItem>
        {sendMonth && (
          <DropdownMenuItem
            icon={<Icon icon={Send} size={16} />}
            onSelect={() =>
              start(async () => {
                const res = await sendReportAction(sendMonth.key);
                if (res.ok)
                  toast.ok({
                    title: ta('sent', { email: res.data!.email }),
                    closeLabel: tc('close'),
                  });
                else
                  toast.error({
                    title: ta(
                      res.error === 'NO_BOOKKEEPER' ? 'error.NO_BOOKKEEPER' : 'error.generic',
                    ),
                    closeLabel: tc('close'),
                  });
              })
            }
          >
            {t('sendBookkeeper', { month: sendMonth.name })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (only === 'export') return exportMenu;
  const pickers = (
    <>
      {linkMenu(types, t('typeLabel'))}
      {linkMenu(periods, t('period'))}
    </>
  );
  if (only === 'pickers') return <div className="grid grid-cols-2 gap-2.5">{pickers}</div>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {pickers}
      {exportMenu}
    </div>
  );
}
