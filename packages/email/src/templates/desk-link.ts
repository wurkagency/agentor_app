import { action, b, define, signOff } from './define.js';

/**
 * E13: "Send link til min computer" on a page that exists only on desktop. To the person
 * themselves. The link needs a login and grants nothing on its own.
 */
export interface DeskLinkProps {
  /** "Mapping for Ordrer → Dinero Fakturaer". */
  page: string;
  url: string;
}

export default define<DeskLinkProps>((p, x) => ({
  subject: x.t('deskLink.subject', { page: p.page }),
  preheader: x.t('deskLink.preheader'),
  blocks: [
    b.heading(x.t('deskLink.heading')),
    b.paragraphs(x.t('deskLink.body', { page: p.page })),
    ...action(x, x.t('deskLink.button'), p.url, null),
    b.divider(),
    b.smallPrint(x.t('deskLink.safety')),
    signOff(x),
  ],
  reason: x.t('deskLink.reason'),
}));
