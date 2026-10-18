'use client';

import { formatDate, formatRelative, type Locale } from '@agentor/i18n';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Checkbox,
  DestructiveDialog,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Icon,
  Input,
  KeyValueList,
  RadioCard,
  RadioGroup,
  StatusPill,
  Table,
  Td,
  Th,
  Tr,
  toast,
} from '@agentor/ui';
import { Ellipsis, Pencil, Plus, ShieldCheck, ShieldAlert, Trash2, Undo2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { PageHeader } from '@/components/shell/secondary-nav';
import { inviteMember, removeTeamMember, updateMember, withdrawInvitation } from './actions';

type Role = 'owner' | 'admin' | 'developer' | 'reader';

export interface MemberVM {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  flowScope: 'all' | 'selected';
  isExternal: boolean;
  twoFactorEnabled: boolean;
  lastActiveAt: string | null;
  grants: { flowId: string; flowName: string; expiresAt: string | null }[];
}

interface InvitationVM {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  flowScope: 'all' | 'selected';
  expiresAt: string;
}

interface Props {
  me: { userId: string; role: Role };
  companyName: string;
  members: MemberVM[];
  invitations: InvitationVM[];
  flows: { id: string; name: string }[];
  /** Seats from the plan (M4); null hides the seat count. */
  seats: { used: number; limit: number | null } | null;
  supportRequiresApproval: boolean;
}

export function TeamView({
  me,
  companyName,
  members,
  invitations,
  flows,
  seats,
  supportRequiresApproval,
}: Props) {
  const t = useTranslations('team');
  const roles = useTranslations('profile.roles');
  const nav = useTranslations('nav');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
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
    if (m.role === 'owner' || m.role === 'admin' || m.flowScope === 'all') {
      return { line: m.role === 'reader' ? t('allFlowsReadOnly') : t('allFlows') };
    }
    const names = m.grants.map((g) => g.flowName).join(', ');
    const expiry = m.grants
      .map((g) => g.expiresAt)
      .filter(Boolean)
      .sort()[0];
    const exp = expiry ? new Date(expiry) : null;
    return {
      line: t('someFlows', { count: m.grants.length, names }),
      sub: exp
        ? exp < new Date()
          ? t('expired', { date: formatDate(exp, locale) })
          : t('expires', { date: formatDate(exp, locale) })
        : undefined,
    };
  };

  const lastActive = (iso: string | null) => {
    if (!iso) return t('never');
    const d = new Date(iso);
    if (Date.now() - d.getTime() < 5 * 60 * 1000) return t('activeNow');
    if (Date.now() - d.getTime() > 7 * 24 * 3600 * 1000) return formatDate(d, locale);
    return formatRelative(d, new Date(), locale);
  };

  const canManage = (m: MemberVM) =>
    m.userId !== me.userId && (m.role !== 'owner' || me.role === 'owner');

  return (
    <>
      <PageHeader
        eyebrow={nav('settings')}
        title={t('title')}
        subtitle={`${t('summary', { members: members.length })} · ${seatsText}`}
        actions={
          <Button variant="primary" size="l" icon={Plus} onClick={() => setInviteOpen(true)}>
            {t('invite')}
          </Button>
        }
      />

      <Card padding="none" className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th className="pl-5">{t('colUser')}</Th>
              <Th>{t('colRole')}</Th>
              <Th>{t('colAccess')}</Th>
              <Th>{t('colLastActive')}</Th>
              <Th>{t('colMfa')}</Th>
              <Th className="w-12">
                <span className="sr-only">{common('moreActions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const a = accessText(m);
              return (
                <Tr key={m.membershipId} interactive>
                  <Td className="pl-5">
                    <span className="inline-flex items-center gap-3">
                      <Avatar name={m.name} />
                      <span className="flex flex-col leading-snug">
                        <strong className="inline-flex items-center gap-1.5 font-semibold">
                          {m.name}
                          {m.userId === me.userId && (
                            <span className="font-normal text-fg-2">({t('you')})</span>
                          )}
                          {m.isExternal && (
                            <span className="inline-flex h-5 items-center rounded-full bg-bg-base px-2 text-micro font-semibold">
                              {t('external')}
                            </span>
                          )}
                        </strong>
                        <span className="text-meta font-medium text-fg-2">{m.email}</span>
                      </span>
                    </span>
                  </Td>
                  <Td className={m.role === 'owner' ? 'font-semibold' : undefined}>
                    {roles(m.role)}
                  </Td>
                  <Td className="whitespace-normal">
                    {a.line}
                    {a.sub && (
                      <span className="block text-meta font-medium text-fg-2">{a.sub}</span>
                    )}
                  </Td>
                  <Td className="text-meta font-medium text-fg-2">{lastActive(m.lastActiveAt)}</Td>
                  <Td>
                    {m.twoFactorEnabled ? (
                      <span className="inline-flex items-center gap-1.5 text-meta font-semibold">
                        <Icon icon={ShieldCheck} size={16} className="text-ok-fg" />
                        {t('mfaOn')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-meta font-semibold">
                        <Icon icon={ShieldAlert} size={16} className="text-warn-fg" />
                        {t('mfaMissing')}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    {canManage(m) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('actions', { name: m.name })}
                          >
                            <Icon icon={Ellipsis} size={18} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            icon={<Icon icon={Pencil} size={16} />}
                            onSelect={() => setEditing(m)}
                          >
                            {t('edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            icon={<Icon icon={Trash2} size={16} />}
                            destructive
                            onSelect={() => setRemoving(m)}
                          >
                            {t('remove')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {invitations.length > 0 && (
        <Card padding="none" className="overflow-hidden" aria-label={t('pending')}>
          <h2 className="m-0 px-5 pb-2 pt-4 text-card">{t('pending')}</h2>
          <Table>
            <tbody>
              {invitations.map((i) => (
                <Tr key={i.id}>
                  <Td className="pl-5 font-semibold">{i.email}</Td>
                  <Td className="text-fg-2">
                    {t('pendingRow', {
                      role: roles(i.role).toLowerCase(),
                      date: formatDate(new Date(i.expiresAt), locale),
                    })}
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="s"
                      variant="secondary"
                      icon={Undo2}
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
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-2.5 p-5">
          <h2 className="m-0 text-card">{t('rolesTitle')}</h2>
          <KeyValueList
            items={(['owner', 'admin', 'developer', 'reader'] as const).map((r) => ({
              label: roles(r),
              value: t(`roleDesc${r.charAt(0).toUpperCase()}${r.slice(1)}` as 'roleDescOwner'),
            }))}
          />
        </Card>
        <Card className="flex flex-col gap-2.5 p-5">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-card">{t('support')}</h2>
            <StatusPill status="paused">{t('supportNoAccess')}</StatusPill>
          </div>
          <p className="m-0 text-table">
            {supportRequiresApproval ? t('supportApproval') : t('supportNoApproval')}
          </p>
          <Link href="/settings/security" className="text-table font-semibold text-fg-1">
            {t('supportSettings')}
          </Link>
        </Card>
      </div>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} flows={flows} />
      {editing && (
        <EditDialog
          member={editing}
          flows={flows}
          meRole={me.role}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <DestructiveDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t('removeTitle', { name: removing.name })}
          consequences={[
            t('removeConsequence1', { name: removing.name, company: companyName }),
            t('removeConsequence2'),
          ]}
          confirmName={removing.name}
          typeLabel={t('removeType')}
          confirmLabel={t('removeConfirm')}
          cancelLabel={common('cancel')}
          closeLabel={common('close')}
          busy={pending}
          onConfirm={() =>
            startTransition(async () => {
              const r = await removeTeamMember(removing.membershipId);
              if (r.ok) {
                toast.ok({
                  title: t('removed', { name: removing.name }),
                  closeLabel: common('close'),
                });
                setRemoving(null);
              } else {
                toast.error({
                  title: t(`errors.${r.error}` as 'errors.generic'),
                  closeLabel: common('close'),
                });
              }
            })
          }
        />
      )}
    </>
  );
}

/* ---- Shared access fields (invite and edit) --------------------------------------------------------- */

interface AccessState {
  flowScope: 'all' | 'selected';
  flowIds: string[];
  accessExpiresAt: string;
  isExternal: boolean;
}

function AccessFields({
  role,
  value,
  onChange,
  flows,
}: {
  role: Role;
  value: AccessState;
  onChange: (v: AccessState) => void;
  flows: { id: string; name: string }[];
}) {
  const t = useTranslations('team');
  const scoped = role === 'developer' || role === 'reader';
  return (
    <>
      {scoped && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1.5 text-table font-medium">{t('access')}</legend>
          <RadioGroup
            value={value.flowScope}
            onValueChange={(v) => onChange({ ...value, flowScope: v as 'all' | 'selected' })}
            className="grid grid-cols-2 gap-2"
          >
            <RadioCard value="all" title={t('scopeAll')} />
            <RadioCard value="selected" title={t('scopeSelected')} />
          </RadioGroup>
          {value.flowScope === 'selected' && (
            <div className="flex flex-col gap-2 rounded-node bg-subrow p-3 shadow-ring-border">
              {flows.map((f) => (
                <label key={f.id} className="flex items-center gap-2.5 text-table">
                  <Checkbox
                    checked={value.flowIds.includes(f.id)}
                    onCheckedChange={(c) =>
                      onChange({
                        ...value,
                        flowIds:
                          c === true
                            ? [...value.flowIds, f.id]
                            : value.flowIds.filter((id) => id !== f.id),
                      })
                    }
                  />
                  {f.name}
                </label>
              ))}
              <p className="m-0 text-meta text-fg-2">{t('scopeHelp')}</p>
            </div>
          )}
          {value.flowScope === 'selected' && (
            <Field label={t('accessExpires')} help={t('accessExpiresHelp')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="date"
                  value={value.accessExpiresAt}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => onChange({ ...value, accessExpiresAt: e.target.value })}
                  className="w-48"
                />
              )}
            </Field>
          )}
        </fieldset>
      )}
      <label className="flex items-start gap-2.5 text-table">
        <Checkbox
          className="mt-0.5"
          checked={value.isExternal}
          onCheckedChange={(c) => onChange({ ...value, isExternal: c === true })}
        />
        <span className="flex flex-col">
          {t('isExternal')}
          <span className="text-meta text-fg-2">{t('isExternalHelp')}</span>
        </span>
      </label>
    </>
  );
}

function in30Days() {
  return new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ---- Invite (D11-Inviter, 560 px) ------------------------------------------------------------------------- */

function InviteDialog({
  open,
  onOpenChange,
  flows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  flows: { id: string; name: string }[];
}) {
  const t = useTranslations('team');
  const roles = useTranslations('profile.roles');
  const common = useTranslations('common');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('developer');
  const [access, setAccess] = useState<AccessState>({
    flowScope: 'selected',
    flowIds: [],
    accessExpiresAt: in30Days(),
    isExternal: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setEmail('');
    setRole('developer');
    setAccess({
      flowScope: 'selected',
      flowIds: [],
      accessExpiresAt: in30Days(),
      isExternal: false,
    });
    setError(null);
  };

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const scoped = role === 'developer' || role === 'reader';
      const r = await inviteMember({
        email,
        role,
        flowScope: scoped ? access.flowScope : 'all',
        flowIds: scoped && access.flowScope === 'selected' ? access.flowIds : [],
        accessExpiresAt:
          scoped && access.flowScope === 'selected' && access.accessExpiresAt
            ? access.accessExpiresAt
            : null,
        isExternal: access.isExternal,
      });
      if (r.ok) {
        toast.ok({
          title: t('invited', { email: email.trim().toLowerCase() }),
          closeLabel: common('close'),
        });
        reset();
        onOpenChange(false);
      } else {
        setError(r.error);
      }
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      width={560}
      title={t('inviteTitle')}
      description={t('inviteIntro')}
      closeLabel={common('close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {common('cancel')}
          </Button>
          <Button
            variant="primary"
            icon={Plus}
            loading={pending}
            disabled={!email.includes('@')}
            onClick={submit}
          >
            {pending ? t('sending') : t('send')}
          </Button>
        </>
      }
    >
      {error && <Banner tone="error">{t(`errors.${error}` as 'errors.generic')}</Banner>}
      <Field label={t('email')}>
        {({ id }) => (
          <Input
            id={id}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-table font-medium">{t('role')}</legend>
        <RadioGroup
          value={role}
          onValueChange={(v) => setRole(v as Exclude<Role, 'owner'>)}
          className="grid grid-cols-3 gap-2"
        >
          <RadioCard value="admin" title={roles('admin')} description={t('roleAdminShort')} />
          <RadioCard
            value="developer"
            title={roles('developer')}
            description={t('roleDeveloperShort')}
          />
          <RadioCard value="reader" title={roles('reader')} description={t('roleReaderShort')} />
        </RadioGroup>
      </fieldset>
      <AccessFields role={role} value={access} onChange={setAccess} flows={flows} />
    </Dialog>
  );
}

/* ---- Edit role and access ----------------------------------------------------------------------------------- */

function EditDialog({
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
  const roleOptions: Role[] =
    meRole === 'owner'
      ? ['owner', 'admin', 'developer', 'reader']
      : ['admin', 'developer', 'reader'];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={560}
      title={t('editTitle', { name: member.name })}
      description={role !== member.role ? t('roleChangeNote') : undefined}
      closeLabel={common('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const r = await updateMember({
                  membershipId: member.membershipId,
                  role,
                  flowScope: access.flowScope,
                  flowIds: access.flowScope === 'selected' ? access.flowIds : [],
                  accessExpiresAt:
                    access.flowScope === 'selected' && access.accessExpiresAt
                      ? access.accessExpiresAt
                      : null,
                  isExternal: access.isExternal,
                });
                if (r.ok) {
                  toast.ok({ title: t('saved'), closeLabel: common('close') });
                  onClose();
                } else setError(r.error);
              })
            }
          >
            {t('saveChanges')}
          </Button>
        </>
      }
    >
      {error && <Banner tone="error">{t(`errors.${error}` as 'errors.generic')}</Banner>}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-table font-medium">{t('role')}</legend>
        <RadioGroup
          value={role}
          onValueChange={(v) => setRole(v as Role)}
          className="grid grid-cols-2 gap-2"
        >
          {roleOptions.map((r) => (
            <RadioCard key={r} value={r} title={roles(r)} />
          ))}
        </RadioGroup>
      </fieldset>
      <AccessFields role={role} value={access} onChange={setAccess} flows={flows} />
    </Dialog>
  );
}
