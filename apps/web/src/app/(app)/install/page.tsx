import {
  MobileCard,
  MobileFootnote,
  MobileShell,
  Responsive,
  Row,
  SectionHeading,
} from '@agentor/ui/mobile';
import { Share } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '@/components/mobile/chrome';
import { DesktopRedirect } from '@/components/mobile/desktop-redirect';
import { requireAppContext } from '@/server/auth/session';
import { InstallActions } from './install-actions';

export async function generateMetadata() {
  const t = await getTranslations('mobile.install');
  return { title: t('title') };
}

function Step({
  n,
  title,
  meta,
  icon,
}: {
  n: number;
  title: string;
  meta: string;
  icon?: boolean;
}) {
  return (
    <Row
      leading={
        <span
          aria-hidden
          className="grid size-7 flex-none place-items-center rounded-full bg-fg-1 text-table font-bold text-white"
        >
          {n}
        </span>
      }
      title={title}
      meta={meta}
      trailing={
        icon ? <Share aria-hidden width={18} height={18} className="flex-none text-fg-2" /> : null
      }
    />
  );
}

/** MA13 Føj til hjemmeskærm: the iOS steps, Android's prompt; hidden once installed. */
export default async function InstallPage() {
  await requireAppContext();
  const t = await getTranslations('mobile.install');
  const mobile = (
    <MobileShell topBar={<AppTopBar back="/more" title={t('title')} />}>
      <MobileCard>
        <div className="flex items-center gap-3.5 p-5">
          {/* The app icon from docs/assets/favicon.svg (B9). */}
          <img
            src="/icons/agentor.svg"
            alt=""
            width={56}
            height={56}
            className="flex-none rounded-bubble"
          />
          <div className="flex flex-col leading-snug">
            <strong className="text-m-hero font-semibold">{t('heroTitle')}</strong>
            <span className="text-meta font-medium text-fg-2">{t('heroBody')}</span>
          </div>
        </div>
      </MobileCard>
      <SectionHeading>{t('ios')}</SectionHeading>
      <MobileCard>
        <Step n={1} title={t('step1')} meta={t('step1Meta')} icon />
        <Step n={2} title={t('step2')} meta={t('step2Meta')} />
        <Step n={3} title={t('step3')} meta={t('step3Meta')} />
      </MobileCard>
      <MobileFootnote>{t('android')}</MobileFootnote>
      <MobileFootnote>{t('iosVersion')}</MobileFootnote>
      <InstallActions />
    </MobileShell>
  );
  return <Responsive desktop={<DesktopRedirect href="/" label={t('title')} />} mobile={mobile} />;
}
