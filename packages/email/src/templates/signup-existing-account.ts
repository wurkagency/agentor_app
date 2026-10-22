import { action, b, define, signOff } from './define.js';

/**
 * E07: sent instead of E06 when the address already has an account. The signup page answers
 * exactly as for a new address, so nobody can probe which e-mails exist.
 */
export interface SignupExistingAccountProps {
  email: string;
  loginUrl: string;
}

export default define<SignupExistingAccountProps>((p, x) => ({
  subject: x.t('signupExisting.subject'),
  preheader: x.t('signupExisting.preheader'),
  blocks: [
    b.heading(x.t('signupExisting.heading')),
    b.paragraphs(x.t('common.hello'), x.t('signupExisting.body')),
    ...action(x, x.t('signupExisting.button'), p.loginUrl, null),
    b.divider(),
    b.smallPrint(x.t('signupExisting.safety')),
    signOff(x),
  ],
  reason: x.t('signupExisting.reason', { email: p.email }),
}));
