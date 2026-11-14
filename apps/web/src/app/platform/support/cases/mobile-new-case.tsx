'use client';

import { BigButton } from '@agentor/ui/mobile';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { NewCaseDialog } from '@/components/platform/new-case-dialog';

/** MP02 "Ny sag": the desktop dialog (G8: no mobile board yet, needs design approval). */
export function MobileNewCase({ customers }: { customers: { id: string; name: string }[] }) {
  const t = useTranslations('mobile.platform.cases');
  const [open, setOpen] = useState(false);
  return (
    <>
      <BigButton className="mt-auto" icon={Plus} onClick={() => setOpen(true)}>
        {t('newCase')}
      </BigButton>
      {open && <NewCaseDialog customers={customers} onClose={() => setOpen(false)} />}
    </>
  );
}
