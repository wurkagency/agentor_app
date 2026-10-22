import { b, define, signOff } from './define.js';

/** E04: the 6-digit code sent to the new address when the login e-mail is changed (10 min.). */
export interface EmailChangeCodeProps {
  code: string;
  /** The new address the code is sent to. */
  email: string;
}

export default define<EmailChangeCodeProps>((p, x) => ({
  subject: x.t('emailChangeCode.subject', { code: p.code }),
  preheader: x.t('emailChangeCode.preheader'),
  blocks: [
    b.heading(x.t('emailChangeCode.heading')),
    b.paragraphs(x.t('common.hello'), x.t('emailChangeCode.body')),
    b.codeBoxes(p.code, x.t('common.codeLabel', { code: p.code })),
    b.expiry(x.t('common.codeExpiry'), x.assets),
    b.divider(),
    b.smallPrint(x.t('emailChangeCode.safety')),
    signOff(x),
  ],
  reason: x.t('emailChangeCode.reason', { email: p.email }),
}));
