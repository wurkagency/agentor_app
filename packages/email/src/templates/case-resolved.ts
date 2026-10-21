import { b, define, signOff } from './define.js';

/**
 * E12: support resolves a case and chooses to send it, one mail per chosen contact. History, time
 * and the satisfaction question are switched on and off by the supporter. Internal notes never
 * reach this template: the caller passes only customer messages, replies, status changes and
 * plain session summaries. Reply-To is the case's reply address; a reply within 14 days reopens.
 */
export interface CaseResolvedProps {
  firstName: string;
  number: number;
  title: string;
  /** The supporter's closing message; may contain {name} for the recipient's first name. */
  closing: string;
  history: CaseHistoryItem[] | null;
  minutes: number | null;
  askSatisfaction: boolean;
  /** "Anne". */
  staffFirstName: string;
  company: string;
}

export interface CaseHistoryItem {
  who: string;
  at: Date;
  body: string;
  kind: 'customer' | 'agentor' | 'staff' | 'status';
}

/**
 * The preheader from the closing message, as on the board: the first sentence after a greeting,
 * cut at its first comma. "Hej Mette. Fakturaerne … igen, og de 3 ordrer …" → "Fakturaerne … igen."
 */
export function leadSentence(text: string): string {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const greeting = /^(hej|hi|hello|kære|dear)\b/i.test(sentences[0] ?? '');
  const sentence = ((greeting ? sentences[1] : sentences[0]) ?? '').trim();
  const clause = sentence.split(/,\s/)[0]!.replace(/[.!?]$/, '');
  return clause ? `${clause}${sentence.match(/[!?]$/)?.[0] ?? '.'}` : '';
}

export default define<CaseResolvedProps>((p, x) => {
  const closing = (
    p.closing.trim() || x.t('caseResolved.defaultClosing', { title: p.title, name: p.firstName })
  ).replaceAll('{name}', p.firstName);
  return {
    subject: x.t('caseResolved.subject', { title: p.title, number: p.number }),
    preheader: leadSentence(closing) || x.t('caseResolved.preheaderFallback'),
    blocks: [
      b.heading(x.t('caseResolved.heading')),
      b.paragraphs(closing),
      ...(p.history && p.history.length
        ? [
            b.timeline(
              x.t('caseResolved.history'),
              // As on the board: "i dag 11:02" on the first entry of a day, then just "11:15".
              p.history.map((h, i) => ({
                who: h.who,
                when:
                  i > 0 && x.day(p.history![i - 1]!.at) === x.day(h.at)
                    ? x.time(h.at)
                    : x.day(h.at) === x.day(x.ctx.now)
                      ? x.t('common.todayShort', { time: x.time(h.at) })
                      : x.dateTime(h.at),
                body: h.body,
                dot: h.kind,
              })),
            ),
          ]
        : []),
      ...(p.minutes !== null
        ? [b.keyValueTable([{ label: x.t('caseResolved.time'), value: x.minutes(p.minutes) }])]
        : []),
      ...(p.askSatisfaction
        ? [b.panel(x.t('caseResolved.satisfactionTitle'), x.t('caseResolved.satisfactionBody'))]
        : []),
      b.smallPrint(x.t('caseResolved.reopen', { number: p.number })),
      signOff(x, x.t('caseResolved.signature', { name: p.staffFirstName })),
    ],
    reason: x.t('caseResolved.reason', { number: p.number, company: p.company }),
  };
});
