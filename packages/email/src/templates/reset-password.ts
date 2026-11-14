import { action, b, define, hello, signOff } from './define.js';

/** E02: "Glemt adgangskode?" on the login page. The link works for 1 hour. */
export interface ResetPasswordProps {
  name: string | null;
  email: string;
  url: string;
}

export default define<ResetPasswordProps>((p, x) => ({
  subject: x.t('resetPassword.subject'),
  preheader: x.t('resetPassword.preheader'),
  blocks: [
    b.heading(x.t('resetPassword.heading')),
    b.paragraphs(hello(x, p.name), x.t('resetPassword.body')),
    ...action(x, x.t('resetPassword.button'), p.url, x.t('resetPassword.expiry')),
    b.divider(),
    b.smallPrint(x.t('resetPassword.safety')),
    signOff(x),
  ],
  reason: x.t('resetPassword.reason', { email: p.email }),
}));
