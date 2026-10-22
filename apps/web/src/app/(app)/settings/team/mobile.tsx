'use client';

import { formatDate, formatRelative, type Locale } from '@agentor/i18n';
import { Avatar, Banner, Icon, toast } from '@agentor/ui';
import {
  BigButton,
  CardActions,
  CardButton,
  ExpandCard,
  KV,
  MobileCard,
  MobileField,
  MobileInput,
  MobilePageTitle,
  MobileShell,
  Modal,
  RowIcon,
  RowLink,
  SectionHeading,
  Chevron,
} from '@agentor/ui/mobile';
import { CircleAlert, CircleCheck, Lock, UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { AppTopBar } from '@/components/mobile/chrome';
import { useNow } from '@/components/now';
import { removeTeamMember, updateMember, withdrawInvitation } from './actions';
import { InviteSheet } from './invite-sheet';
import { MobileAccessFields, RoleCards, type AccessState, type Role } from './mobile-fields';
import type { MemberVM } from './team-view';

interface InvitationVM {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  flowScope: 'all' | 'selected';
  expiresAt: string;
}

/**
 * MA29 Team og adgang: one folding card per user (e-mail, role, access, last active, two-step),
 * "Skift rolle" and "Fjern" in the folded-out card, the support row and the "Invitér" button
 * that opens MA30. Same data and actions as D11-Team.
 */
export function TeamMobile({
  me,
  companyName,
  members,
  invitations,
  flows,
  seats,
  supportRequiresApproval,
}: {
  me: { userId: string; role: Role };
  companyName: string;
  members: MemberVM[];
  invitations: InvitationVM[];
  flows: { id: string; name: string }[];
  seats: { used: number; limit: number | null } | null;
  supportRequiresApproval: boolean;
}) {
  const t = useTranslations('team');
  const tm = useTranslations('mobile.team');
  const roles = useTranslations('profile.roles');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
  const now = useNow();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<MemberVM | null>(null);
  const [removing, setRemoving] = useState<MemberVM | null>(null);
  const [pending, startTransition] = useTransition();

  const seatsText = seats
    ? seats.limit === null
      ? t('seatsUnlimited')
      : t('seatsLimited', { used: seats.used, limit: seats.limit })
    : t('externalNote');

  const accessText = (m: MemberVM) => {
    if (m.role === 'owner' || m.role === 'admin' || m.flowScope === 'all')
      return m.role === 'reader' ? t('allFlowsReadOnly') : t('allFlows');
    const names = m.grants.map((g) => g.flowName).join(', ');
    const expiry = m.grants
      .map((g) => g.expiresAt)
      .filter(Boolean)
      .sort()[0];
    const line = t('someFlows', { count: m.grants.length, names });
    if (!expiry) return line;
    const exp = new Date(expiry);
    const date = formatDate(exp, locale);
    return `${line} · ${exp < now ? tm('expiredLower', { date }) : tm('expiresLower', { date })}`;
  };

  const lastActive = (iso: string | null) => {
    if (!iso) return t('never');
    const d = new Date(iso);
    if (now.getTime() - d.getTime() < 5 * 60 * 1000) return t('activeNow');
    if (now.getTime() - d.getTime() > 7 * 24 * 3600 * 1000) return formatDate(d, locale);
    return formatRelative(d, now, locale);
  };

  const canManage = (m: MemberVM) =>
    m.userId !== me.userId && (m.role !== 'owner' || me.role === 'owner');

  return (
    <MobileShell topBar={<AppTopBar back="/more" title={t('title')} />}>
      <MobilePageTitle
        title={t('title')}
        subtitle={`${t('summary', { members: members.length })} · ${seatsText}`}
      />
      {members.map((m) => {
        const access = accessText(m);
        return (
          <ExpandCard
            key={m.membershipId}
            leading={
              <Avatar name={m.name} size={32} tone={m.userId === me.userId ? 'navy' : 'light'} />
            }
            title={
              <span className="inline-flex max-w-full items-center gap-1.5">
                <span className="truncate">{m.name}</span>
                {m.userId === me.userId && (
                  <span className="font-medium text-fg-2">({t('you')})</span>
                )}
                {m.isExternal && (
                  <span className="inline-flex h-4.5 flex-none items-center rounded-full bg-bg-base px-2 text-micro font-semibold">
                    {t('external')}
                  </span>
                )}
              </span>
            }
            meta={`${roles(m.role)} · ${access}`}
          >
            <KV k={t('email')}>{m.email}</KV>
            <KV k={t('role')}>{roles(m.role)}</KV>
            <KV k={t('access')}>{access}</KV>
            <KV k={t('colLastActive')}>{lastActive(m.lastActiveAt)}</KV>
            <KV k={t('colMfa')}>
              {m.twoFactorEnabled ? (
                <span className="inline-flex h-5.5 items-center gap-1 rounded-full bg-ok-bg px-2 text-meta font-semibold">
                  <Icon icon={CircleCheck} size={14} className="text-ok-fg" />
                  {t('mfaOn')}
                </span>
              ) : (
                <span className="inline-flex h-5.5 items-center gap-1 rounded-full bg-warn-bg px-2 text-meta font-semibold">
                  <Icon icon={CircleAlert} size={14} className="text-warn-fg" />
                  {t('mfaMissing')}
                </span>
              )}
            </KV>
            {canManage(m) && (
              <CardActions>
                <CardButton onClick={() => setEditing(m)}>{tm('changeRole')}</CardButton>
                <CardButton variant="destructive" onClick={() => setRemoving(m)}>
                  {tm('remove')}
                </CardButton>
              </CardActions>
            )}
          </ExpandCard>
        );
      })}

      {invitations.length > 0 && (
        <>
          <SectionHeading>{t('pending')}</SectionHeading>
          {invitations.map((i) => (
            <ExpandCard
              key={i.id}
              title={i.email}
              meta={tm('invitationMeta', {
                role: roles(i.role),
                date: formatDate(new Date(i.expiresAt), locale),
              })}
            >
              <CardActions>
                <CardButton
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await withdrawInvitation(i.id);
                      if (r.ok) toast.ok({ title: t('revoked'), closeLabel: common('close') });
                      else
                        toast.error({
                          title: t(`errors.${r.error}` as 'errors.generic'),
                          closeLabel: common('close'),
                        });
                    })
                  }
                >
                  {t('revoke')}
                </CardButton>
              </CardActions>
            </ExpandCard>
          ))}
        </>
      )}

      <SectionHeading>{t('support')}</SectionHeading>
      <MobileCard>
        <RowLink
          href="/settings/security"
          linkAs={Link}
          leading={<RowIcon icon={Lock} tone="neutral" />}
          title={t('supportNoAccess')}
          meta={supportRequiresApproval ? tm('supportMetaApproval') : tm('supportMetaNoApproval')}
          trailing={<Chevron />}
        />
      </MobileCard>

      {/* Room so the floating button never covers the last card. */}
      <div aria-hidden className="h-14 flex-none" />
      <div className="fixed bottom-tabbar-gap right-4 z-20">
        <BigButton
          icon={UserPlus}
          onClick={() => setInviteOpen(true)}
          className="w-auto px-5.5 shadow-card"
        >
          {t('invite')}
        </BigButton>
      </div>

      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} flows={flows} />
      {editing && (
        <EditModal
          member={editing}
          flows={flows}
          meRole={me.role}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <RemoveModal
          member={removing}
          companyName={companyName}
          onClose={() => setRemoving(null)}
        />
      )}
    </MobileShell>
  );
}

/* ---- Skift rolle: role and access, the desktop EditDialog as a modal ------------------------------ */

function EditModal({
  member,
  flows,
  meRole,
  onClose,
}: {
  member: MemberVM;
  flows: { id: string; name: string }[];
  meRole: Role;
  onClose: () => void;
}) {
  const t = useTranslations('team');
  const roles = useTranslations('profile.roles');
  const common = useTranslations('common');
  const [role, setRole] = useState<Role>(member.role);
  const firstExpiry = member.grants
    .map((g) => g.expiresAt)
    .filter(Boolean)
    .sort()[0];
  const [access, setAccess] = useState<AccessState>({
    flowScope: member.flowScope,
    flowIds: member.grants.map((g) => g.flowId),
    accessExpiresAt: firstExpiry ? firstExpiry.slice(0, 10) : '',
    isExternal: member.isExternal,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options: Role[] =
    meRole === 'owner'
      ? ['owner', 'admin', 'developer', 'reader']
      : ['admin', 'developer', 'reader'];
  const short: Partial<Record<Role, string>> = {
    admin: t('roleAdminShort'),
    developer: t('roleDeveloperShort'),
    reader: t('roleReaderShort'),
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const scoped = role === 'developer' || role === 'reader';
      const selected = scoped && access.flowScope === 'selected';
      const r = await updateMember({
        membershipId: member.membershipId,
        role,
        flowScope: scoped ? access.flowScope : 'all',
        flowIds: selected ? access.flowIds : [],
        accessExpiresAt: selected && access.accessExpiresAt ? access.accessExpiresAt : null,
        isExternal: access.isExternal,
      });
      if (r.ok) {
        toast.ok({ title: t('saved'), closeLabel: common('close') });
        onClose();
      } else setError(r.error);
    });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('editTitle', { name: member.name })}
      {...(role !== member.role ? { description: t('roleChangeNote') } : {})}
      closeLabel={common('close')}
      footer={
        <>
          <BigButton variant="secondary" onClick={onClose}>
            {common('cancel')}
          </BigButton>
          <BigButton loading={pending} onClick={save}>
            {t('saveChanges')}
          </BigButton>
        </>
      }
    >
      {error && <Banner tone="error">{t(`errors.${error}` as 'errors.generic')}</Banner>}
      <RoleCards<Role>
        name="edit-role"
        value={role}
        onChange={setRole}
        options={options.map((r) => ({
          value: r,
          title: roles(r),
          ...(short[r] ? { description: short[r] } : {}),
        }))}
      />
      <MobileAccessFields role={role} value={access} onChange={setAccess} flows={flows} />
    </Modal>
  );
}

/* ---- Fjern: the desktop DestructiveDialog's consequences and typed name ---------------------------- */

function RemoveModal({
  member,
  companyName,
  onClose,
}: {
  member: MemberVM;
  companyName: string;
  onClose: () => void;
}) {
  const t = useTranslations('team');
  const common = useTranslations('common');
  const [typed, setTyped] = useState('');
  const [pending, startTransition] = useTransition();
  const matches = typed.trim().toLowerCase() === member.name.trim().toLowerCase();

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('removeTitle', { name: member.name })}
      closeLabel={common('close')}
      footer={
        <>
          <BigButton variant="secondary" onClick={onClose}>
            {common('cancel')}
          </BigButton>
          <BigButton
            variant="destructive"
            loading={pending}
            disabled={!matches}
            onClick={() =>
              startTransition(async () => {
                const r = await removeTeamMember(member.membershipId);
                if (r.ok) {
                  toast.ok({
                    title: t('removed', { name: member.name }),
                    closeLabel: common('close'),
                  });
                  onClose();
                } else {
                  toast.error({
                    title: t(`errors.${r.error}` as 'errors.generic'),
                    closeLabel: common('close'),
                  });
                }
              })
            }
          >
            {t('removeConfirm')}
          </BigButton>
        </>
      }
    >
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-table">
        <li>{t('removeConsequence1', { name: member.name, company: companyName })}</li>
        <li>{t('removeConsequence2')}</li>
      </ul>
      <MobileField label={t('removeType')}>
        <MobileInput
          autoComplete="off"
          autoCapitalize="words"
          placeholder={member.name}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </MobileField>
    </Modal>
  );
}
