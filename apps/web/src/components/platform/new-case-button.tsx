'use client';

import { Button, Icon } from '@agentor/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { NewCaseDialog } from './new-case-dialog';

export function NewCaseButton({
  customers,
  defaultTenantId,
  defaultTitle,
  size = 'l',
}: {
  customers: { id: string; name: string }[];
  defaultTenantId?: string;
  defaultTitle?: string;
  size?: 'l' | 's';
}) {
  const t = useTranslations('platform.cases');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={size === 'l' ? 'primary' : 'secondary'}
        size={size}
        onClick={() => setOpen(true)}
      >
        <Icon icon={Plus} size={16} />
        {size === 'l' ? t('new') : t('createShort')}
      </Button>
      {open && (
        <NewCaseDialog
          customers={customers}
          onClose={() => setOpen(false)}
          {...(defaultTenantId ? { defaultTenantId } : {})}
          {...(defaultTitle ? { defaultTitle } : {})}
        />
      )}
    </>
  );
}
