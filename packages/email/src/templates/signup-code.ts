import { b, define, signOff } from './define.js';

/** E06: signup step 1 and "send koden igen". 6 digits, 10 minutes, code first in the subject. */
export interface SignupCodeProps {
  code: string;
  email: string;
}

export default define<SignupCodeProps>((p, x) => ({
  subject: x.t('signupCode.subject', { code: p.code }),
  preheader: x.t('signupCode.preheader'),
  blocks: [
    b.heading(x.t('signupCode.heading')),
    b.paragraphs(x.t('common.hello'), x.t('signupCode.body')),
    b.codeBoxes(p.code, x.t('common.codeLabel', { code: p.code })),
    b.expiry(x.t('common.codeExpiry'), x.assets),
    b.divider(),
    b.smallPrint(x.t('signupCode.safety')),
    signOff(x),
  ],
  reason: x.t('signupCode.reason', { email: p.email }),
}));
