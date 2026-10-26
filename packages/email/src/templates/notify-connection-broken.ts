import { b, define, signOff } from './define.js';

/**
 * E19: a connection stopped working. To members with e-mail on for "Forbindelse afbrudt".
 * Critical: sent at once, also in quiet hours. Sent by the worker from the e-mail queue.
 */
export interface NotifyConnectionBrokenProps {
  firstName: string | null;
  /** "e-conomic". */
  system: string;
  /** The connection's own name, "Nordlys Outlet". */
  account: string;
  /** 'expired': the access ran out; anything else is described as "virker ikke længere". */
  cause: 'expired' | 'other';
  since: Date;
  /** The flows that use it, most affected first. */
  flows: { name: string; routes: number }[];
  /** Records waiting for the connection, and what they are ("ordrer"). */
  queued: number;
  url: string;
  company: string;
  settingsUrl: string;
}

export default define<NotifyConnectionBrokenProps>((p, x) => {
  const when = x.when(p.since);
  const first = p.flows[0];
  const flowList = p.flows.map((f) => f.name).join(', ');
  const affected =
    p.flows.length === 1 && first
      ? x.t('connectionBroken.affectedOne', { flow: first.name, routes: first.routes })
      : x.t('connectionBroken.affectedMany', {
          count: p.flows.length,
          routes: p.flows.reduce((a, f) => a + f.routes, 0),
        });
  return {
    subject: first
      ? x.t('connectionBroken.subject', { system: p.system, flow: first.name })
      : x.t('connectionBroken.subjectNoFlow', { system: p.system }),
    preheader: x.t(`connectionBroken.preheader.${p.cause}`, { when }),
    blocks: [
      b.heading(x.t('connectionBroken.heading', { system: p.system })),
      b.paragraphs(
        p.firstName ? x.t('common.helloName', { name: p.firstName }) : x.t('common.hello'),
        [
          x.t(`connectionBroken.body.${p.cause}`, {
            system: p.system,
            account: p.account,
            when,
          }),
          p.flows.length === 1
            ? x.t('connectionBroken.stalledOne', { flows: flowList })
            : p.flows.length > 1
              ? x.t('connectionBroken.stalledMany', { flows: flowList })
              : '',
        ]
          .filter(Boolean)
          .join(' '),
      ),
      b.keyValueTable([
        ...(p.flows.length ? [{ label: x.t('connectionBroken.affected'), value: affected }] : []),
        {
          label: x.t('connectionBroken.queued'),
          value: x.t('connectionBroken.queuedValue', { count: p.queued }),
        },
      ]),
      b.button(x.t('connectionBroken.button', { system: p.system }), p.url),
      b.smallPrint(x.t('connectionBroken.hint', { system: p.system })),
      signOff(x),
    ],
    reason: x.t('common.reasonNotify', {
      event: x.t('common.event.connection_broken'),
      company: p.company,
    }),
    footerLink: { label: x.t('common.editNotifications'), href: p.settingsUrl },
  };
});
