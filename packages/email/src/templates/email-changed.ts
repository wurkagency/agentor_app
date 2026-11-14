import { b, define, signOff } from './define.js';

/**
 * E05: to the old address after the login e-mail changed. No button and no link, only the way to
 * support. The new address is masked (me•••@nordlys-cykler.dk).
 */
export interface EmailChangedProps {
  /** The old address this goes to. */
  email: string;
  /** Masked new address. */
  newEmailMasked: string;
  at: Date;
  /** "Safari på iPhone", when known. */
  device: string | null;
}

/** "mette.holm@nordlys-cykler.dk" → "me•••@nordlys-cykler.dk". */
export function maskAddress(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '•••';
  return `${local.slice(0, Math.min(2, local.length))}•••@${domain}`;
}

export default define<EmailChangedProps>((p, x) => ({
  subject: x.t('emailChanged.subject'),
  preheader: x.t('emailChanged.preheader'),
  blocks: [
    b.heading(x.t('emailChanged.heading')),
    b.paragraphs(x.t('common.hello'), x.t('emailChanged.body', { email: p.newEmailMasked })),
    b.keyValueTable([
      { label: x.t('emailChanged.time'), value: x.dateTime(p.at) },
      ...(p.device ? [{ label: x.t('emailChanged.device'), value: p.device }] : []),
    ]),
    b.notice('warning', x.t('emailChanged.noticeTitle'), x.t('emailChanged.noticeBody'), x.assets),
    b.divider(),
    b.smallPrint(x.t('emailChanged.safety')),
    signOff(x),
  ],
  reason: x.t('emailChanged.reason', { email: p.email }),
}));
