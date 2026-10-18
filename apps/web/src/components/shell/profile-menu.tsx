'use client';

import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Icon,
} from '@agentor/ui';
import { Building2, CreditCard, Languages, LogOut, Settings, UserRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';
import { changeLocale, switchTenant } from '@/app/actions/session';
import { authClient } from '@/lib/auth-client';

export interface ProfileMenuProps {
  user: { name: string; email: string };
  tenant: {
    id: string;
    name: string;
    shortName: string;
    role: 'owner' | 'admin' | 'developer' | 'reader';
  };
  /** All tenants the user belongs to; "Skift virksomhed" shows only with more than one (Q33). */
  tenants: { id: string; name: string }[];
  /** Usage hint on "Abonnement og forbrug", e.g. "71 %". */
  usageHint?: string | undefined;
}

/**
 * Profile menu (App-skal-B, README decision 3): Skift virksomhed, Min profil, Indstillinger,
 * Abonnement og forbrug, Sprog, Log ud.
 */
export function ProfileMenu({
  user,
  tenant,
  tenants,
  usageHint,
  trigger,
}: ProfileMenuProps & { trigger: ReactNode }) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const canSeeSettings = tenant.role === 'owner' || tenant.role === 'admin';
  const canSeeBilling = tenant.role === 'owner';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-75" aria-label={t('menu')}>
        <div className="flex items-center gap-3 px-3 pb-3.5 pt-2.5">
          <Avatar name={user.name} size={40} tone="navy" />
          <span className="flex min-w-0 flex-col leading-snug">
            <strong className="truncate text-body font-semibold">{user.name}</strong>
            <span className="truncate text-meta text-fg-2">
              {t(`roles.${tenant.role}`)} · {tenant.name}
            </span>
          </span>
        </div>
        {tenants.length > 1 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              icon={<Icon icon={Building2} size={16} />}
              hint={tenants.length}
              className="mb-2 shadow-ring-border"
            >
              {t('switchCompany')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={tenant.id}
                onValueChange={(id) =>
                  startTransition(async () => {
                    const res = await switchTenant(id);
                    if (res.ok) {
                      router.push('/');
                      router.refresh();
                    }
                  })
                }
              >
                {tenants.map((x) => (
                  <DropdownMenuRadioItem key={x.id} value={x.id}>
                    {x.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem
          icon={<Icon icon={UserRound} size={16} />}
          onSelect={() => router.push('/settings/profile')}
        >
          {t('myProfile')}
        </DropdownMenuItem>
        {canSeeSettings && (
          <DropdownMenuItem
            icon={<Icon icon={Settings} size={16} />}
            onSelect={() => router.push('/settings/company')}
          >
            {t('settings')}
          </DropdownMenuItem>
        )}
        {canSeeBilling && (
          <DropdownMenuItem
            icon={<Icon icon={CreditCard} size={16} />}
            hint={usageHint}
            onSelect={() => router.push('/billing')}
          >
            {t('billing')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            icon={<Icon icon={Languages} size={16} />}
            hint={locale === 'en' ? t('english') : t('danish')}
          >
            {t('language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(v) =>
                startTransition(async () => {
                  await changeLocale(v === 'en' ? 'en' : 'da');
                  router.refresh();
                })
              }
            >
              <DropdownMenuRadioItem value="da" lang="da">
                {t('danish')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en" lang="en">
                {t('english')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Icon icon={LogOut} size={16} />}
          onSelect={() =>
            startTransition(async () => {
              await authClient.signOut();
              router.replace('/login');
              router.refresh();
            })
          }
        >
          {t('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
