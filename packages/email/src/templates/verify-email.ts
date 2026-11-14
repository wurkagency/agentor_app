import { action, b, define, hello, signOff } from './define.js';

/** E01: sign-in without a verified e-mail (Better Auth link, 24 hours). */
export interface VerifyEmailProps {
  name: string | null;
  email: string;
  url: string;
}

export default define<VerifyEmailProps>((p, x) => ({
  subject: x.t('verifyEmail.subject'),
  preheader: x.t('verifyEmail.preheader'),
  blocks: [
    b.heading(x.t('verifyEmail.heading')),
    b.paragraphs(hello(x, p.name), x.t('verifyEmail.body')),
    ...action(x, x.t('verifyEmail.button'), p.url, x.t('verifyEmail.expiry')),
    b.divider('24px 40px 0'),
    b.smallPrint(x.t('verifyEmail.safety')),
    signOff(x),
  ],
  reason: x.t('verifyEmail.reason', { email: p.email }),
}));
