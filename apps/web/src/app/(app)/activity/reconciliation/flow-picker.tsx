'use client';

import { Select } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';

export function ReconciliationFlowPicker({
  flows,
  value,
}: {
  flows: { id: string; name: string }[];
  value: string;
}) {
  const t = useTranslations('reconciliation');
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Select
      aria-label={t('flowLabel')}
      density="compact"
      className="w-72"
      value={value}
      onValueChange={(v) => router.replace(`${pathname}?flow=${v}`, { scroll: false })}
      options={flows.map((f) => ({ value: f.id, label: f.name }))}
    />
  );
}
