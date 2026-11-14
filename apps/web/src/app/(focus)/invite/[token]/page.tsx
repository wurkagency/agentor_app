import { previewInvitation } from '@agentor/db';
import { Banner, Icon } from '@agentor/ui';
import { MailCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FocusCard } from '@/components/focus-card';
import { getUserSession } from '@/server/auth/session';
import { db } from '@/server/infra';
import { AcceptInvite, CreateAccount, LogoutButton } from './invite-forms';

export async function generateMetadata() {
  const t = await getTranslations('inviteAccept');
  return { title: t('title') };
}

/** Accept an invitation (/invite/[token], produktspecifikation §6). No board; D14 focus pattern. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('inviteAccept');
  const roles = await getTranslations('profile.roles');
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(token);
  const preview = valid ? await previewInvitation(db(), token) : null;

  if (!preview) {
    return (
      <FocusCard title={t('title')}>
        <Banner tone="error">{t('notFound')}</Banner>
      </FocusCard>
    );
  }
  if (preview.state !== 'open') {
    return (
      <FocusCard title={t('title')}>
        <Banner tone="warn">{t('closed')}</Banner>
      </FocusCard>
    );
  }

  const session = await getUserSession();
  const role = roles(preview.role as 'admin').toLowerCase();
  const intro = t('intro', { company: preview.tenant_name, role });
  const icon = <Icon icon={MailCheck} size={24} />;

  if (session) {
    if (session.user.email.toLowerCase() !== preview.email) {
      return (
        <FocusCard title={t('title')} intro={intro} icon={icon}>
          <Banner tone="warn">{t('wrongUser', { invited: preview.email })}</Banner>
          <LogoutButton />
        </FocusCard>
      );
    }
    return (
      <FocusCard title={t('title')} intro={intro} icon={icon}>
        <p className="m-0 text-table text-fg-2">{t('signedInAs', { email: session.user.email })}</p>
        <AcceptInvite token={token} />
      </FocusCard>
    );
  }

  return (
    <FocusCard title={t('createTitle')} intro={intro} icon={icon}>
      <CreateAccount token={token} email={preview.email} />
      <p className="m-0 text-center text-table text-fg-2">
        {t('hasAccount')}{' '}
        <Link
          href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
          className="font-semibold text-fg-1"
        >
          {t('login')}
        </Link>
      </p>
    </FocusCard>
  );
}
