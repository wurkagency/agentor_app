import { BigButtonLink, MobileCard, MobileShell, RowIcon } from '@agentor/ui/mobile';
import { Laptop } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';
import { AppTopBar, PlatformTopBar } from './chrome';
import { SendDeskLinkButton } from './send-desk-link';

export type DeskArea =
  | 'editor'
  | 'newFlow'
  | 'settings'
  | 'reconciliation'
  | 'plan'
  | 'supportView'
  | 'finance'
  | 'platformAdmin'
  | 'generic';

/**
 * What a desktop-only route shows below 768 px (README decision 20, designspec §8): the grey
 * computer line as a screen of its own and "Send link til min computer".
 */
export async function DeskOnly({
  area,
  title,
  platform = false,
}: {
  area: DeskArea;
  /** Page name in the top bar and the e-mail's subject. */
  title: string;
  platform?: boolean;
}) {
  const t = await getTranslations('mobile.desk');
  const Bar = platform ? PlatformTopBar : AppTopBar;
  return (
    <MobileShell topBar={<Bar back={platform ? '/platform/customers' : '/'} title={title} />}>
      <MobileCard>
        <div className="flex flex-col items-center gap-2.5 p-5 text-center">
          <RowIcon icon={Laptop} tone="neutral" size={52} />
          <h2 className="m-0 text-m-request">{t('title')}</h2>
          <p className="m-0 text-fg-2">{t(`areas.${area}`)}</p>
        </div>
      </MobileCard>
      <div className="mt-auto flex flex-col gap-2">
        {/* useSearchParams needs a boundary when the page is static. */}
        <Suspense>
          <SendDeskLinkButton title={title} />
        </Suspense>
        <BigButtonLink
          href={platform ? '/platform/customers' : '/'}
          variant="secondary"
          linkAs={Link}
        >
          {platform ? t('toPlatform') : t('toOverview')}
        </BigButtonLink>
      </div>
    </MobileShell>
  );
}
