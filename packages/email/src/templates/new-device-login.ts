import { b, define, hello, signOff } from './define.js';

/**
 * E03: sign-in from a browser or device not seen before. Deliberately no button and no link, so
 * it can't be mistaken for phishing; the way out is the app and support.
 */
export interface NewDeviceLoginProps {
  name: string | null;
  email: string;
  /** "Chrome på Windows". */
  device: string;
  /** Approximate place, only when known ("Aarhus, Danmark"). */
  place: string | null;
  at: Date;
}

export default define<NewDeviceLoginProps>((p, x) => {
  const place = p.place ? x.t('newDeviceLogin.approx', { place: p.place }) : null;
  return {
    subject: x.t('newDeviceLogin.subject'),
    // The board's preheader names the city only: "Chrome på Windows · Aarhus · i dag kl. 07:58".
    preheader: [p.device, p.place?.split(',')[0], x.when(p.at)].filter(Boolean).join(' · '),
    blocks: [
      b.heading(x.t('newDeviceLogin.heading')),
      b.paragraphs(hello(x, p.name), x.t('newDeviceLogin.body')),
      b.keyValueTable([
        { label: x.t('newDeviceLogin.device'), value: p.device },
        ...(place ? [{ label: x.t('newDeviceLogin.place'), value: place }] : []),
        { label: x.t('newDeviceLogin.time'), value: x.dateTime(p.at) },
      ]),
      b.notice(
        'info',
        x.t('newDeviceLogin.noticeTitle'),
        x.t('newDeviceLogin.noticeBody'),
        x.assets,
      ),
      b.divider(),
      b.smallPrint(x.t('common.securityNoLinks')),
      signOff(x),
    ],
    reason: x.t('newDeviceLogin.reason', { email: p.email }),
  };
});
