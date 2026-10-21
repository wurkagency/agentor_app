import { action, b, define, signOff } from './define.js';

/**
 * E09: an owner or admin invites someone under Indstillinger › Team. The link works for 7 days.
 * The access and expiry rows appear only when they are set.
 */
export interface TeamInviteProps {
  inviter: string;
  company: string;
  /** "Udvikler". */
  role: string;
  /** "redigerer udvalgte flows". */
  roleDetail: string | null;
  /** "1 flow: Webshop → regnskab og CRM". */
  access: string | null;
  accessExpiresAt: Date | null;
  url: string;
  email: string;
}

export default define<TeamInviteProps>((p, x) => ({
  subject: x.t('teamInvite.subject', { inviter: p.inviter, company: p.company }),
  preheader: x.t('teamInvite.preheader', { role: p.role }),
  blocks: [
    b.heading(x.t('teamInvite.heading', { company: p.company })),
    b.paragraphs(
      x.t('common.hello'),
      x.t('teamInvite.body', { inviter: p.inviter, company: p.company, role: p.role }),
    ),
    b.keyValueTable([
      {
        label: x.t('teamInvite.role'),
        value: p.roleDetail ? `${p.role} · ${p.roleDetail}` : p.role,
      },
      ...(p.access ? [{ label: x.t('teamInvite.access'), value: p.access }] : []),
      ...(p.accessExpiresAt
        ? [{ label: x.t('teamInvite.accessExpires'), value: x.date(p.accessExpiresAt) }]
        : []),
    ]),
    ...action(x, x.t('teamInvite.button'), p.url, x.t('teamInvite.expiry')),
    b.divider(),
    b.smallPrint(x.t('teamInvite.safety')),
    signOff(x),
  ],
  reason: x.t('teamInvite.reason', { inviter: p.inviter, email: p.email }),
}));
