import { b, define, signOff } from './define.js';

/**
 * E20: the same error on at least N records (tenant threshold, default 3) on one route within 15
 * minutes. Why and how to fix use the same texts as the app's error view. Held in quiet hours and
 * then sent as one mail with every incident.
 */
export interface SystematicIncident {
  count: number;
  /** "ordrer", already in the plural that fits `count`. */
  entity: string;
  flow: string;
  at: Date;
  why: string;
  fix: string;
  url: string;
  /** One-line summary for the preheader: "Konto 1010 findes ikke i Dinero. Ret kontoen …". */
  summary: string | null;
}

export interface NotifySystematicErrorProps {
  firstName: string | null;
  incidents: SystematicIncident[];
  company: string;
  overviewUrl: string;
  settingsUrl: string;
}

export default define<NotifySystematicErrorProps>((p, x) => {
  const hello = p.firstName ? x.t('common.helloName', { name: p.firstName }) : x.t('common.hello');
  const reason = x.t('common.reasonNotify', {
    event: x.t('common.event.systematic_error'),
    company: p.company,
  });
  const footerLink = { label: x.t('common.editNotifications'), href: p.settingsUrl };
  const one = p.incidents.length === 1 ? p.incidents[0] : undefined;
  if (one)
    return {
      subject: x.t('systematicError.subject', {
        count: one.count,
        entity: one.entity,
        flow: one.flow,
      }),
      preheader: one.summary ?? one.why,
      blocks: [
        b.heading(x.t('systematicError.heading', { entity: one.entity })),
        b.paragraphs(
          hello,
          x.t('systematicError.body', {
            count: one.count,
            entity: one.entity,
            flow: one.flow,
            when: x.when(one.at),
          }),
        ),
        b.notice('error', x.t('systematicError.why'), one.why, x.assets),
        b.panel(x.t('systematicError.fix'), one.fix, { titleSize: 14, tone: 'fg' }),
        b.button(x.t('systematicError.button'), one.url),
        signOff(x),
      ],
      reason,
      footerLink,
    };
  // Several incidents held over quiet hours: one mail, one block per incident.
  const total = p.incidents.reduce((a, i) => a + i.count, 0);
  return {
    subject: x.t('systematicError.subjectMany', { count: p.incidents.length }),
    preheader: x.t('systematicError.preheaderMany', { count: total }),
    blocks: [
      b.heading(x.t('systematicError.headingMany')),
      b.paragraphs(hello, x.t('systematicError.bodyMany', { count: p.incidents.length })),
      ...p.incidents.map((i) =>
        b.notice(
          'error',
          x.t('systematicError.incident', {
            count: i.count,
            entity: i.entity,
            flow: i.flow,
            when: x.when(i.at),
          }),
          `${i.why}\n${i.fix}`,
          x.assets,
        ),
      ),
      b.button(x.t('systematicError.buttonMany'), p.overviewUrl),
      signOff(x),
    ],
    reason,
    footerLink,
  };
});
