'use client';

import { Button } from '@agentor/ui';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * Sticky Gem/Annullér footer (designspecifikation §5.3): changes are saved explicitly, never
 * auto-saved; leaving with unsaved changes asks first.
 */
export function FormFooter({
  dirty,
  saving,
  onCancel,
}: {
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
}) {
  const t = useTranslations('form');
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-b-md bg-surface px-6 py-4 shadow-hairline-t">
      <span className="text-meta font-medium text-fg-2" aria-live="polite">
        {dirty ? t('unsaved') : ''}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={!dirty || saving}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}
