import { action, b, define, signOff } from './define.js';

/**
 * E11: Platform › Kunde › Administrér resends the owner invitation. 14 days; every earlier link
 * stops working (the invitation service replaces the token).
 */
export interface OwnerReinviteProps {
  staff: string;
  company: string;
  url: string;
  email: string;
}

export default define<OwnerReinviteProps>((p, x) => ({
  subject: x.t('ownerReinvite.subject'),
  preheader: x.t('ownerReinvite.preheader'),
  blocks: [
    b.heading(x.t('ownerReinvite.heading')),
    b.paragraphs(
      x.t('common.hello'),
      x.t('ownerReinvite.body', { staff: p.staff, company: p.company }),
    ),
    ...action(x, x.t('ownerReinvite.button'), p.url, x.t('ownerReinvite.expiry')),
    b.divider(),
    b.smallPrint(x.t('ownerReinvite.safety')),
    signOff(x),
  ],
  reason: x.t('ownerReinvite.reason', { email: p.email }),
}));
