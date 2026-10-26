import { Icon } from '@agentor/ui';
import { Responsive } from '@agentor/ui/mobile';
import { ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { FocusCard } from '@/components/focus-card';
import { MfaForm } from './mfa-form';
import { MobileMfa } from './mobile-mfa';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('mfaTitle') };
}

/** Totrinsbekræftelse (D14-MFA; MA34 below 768 px). */
export default async function MfaPage() {
  const t = await getTranslations('auth');
  return (
    <Responsive
      desktop={
        <FocusCard
          title={t('mfaTitle')}
          intro={t('mfaIntro')}
          icon={<Icon icon={ShieldCheck} size={24} />}
        >
          <MfaForm />
        </FocusCard>
      }
      mobile={<MobileMfa />}
    />
  );
}
