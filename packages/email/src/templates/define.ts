import * as b from '../blocks.js';
import type { Tools } from '../context.js';
import type { EmailContent } from '../layout.js';

/** A template: typed props in, the board's subject, preheader, blocks and reason out. */
export interface Template<P> {
  render(props: P, x: Tools): EmailContent;
}

export const define = <P>(render: (props: P, x: Tools) => EmailContent): Template<P> => ({
  render,
});

/** "Hej Mette" / "Hej" (the boards greet by first name when it is known). */
export function hello(x: Tools, name?: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? x.t('common.helloName', { name: first }) : x.t('common.hello');
}

/** The closing every mail shares: "Venlig hilsen / Agentor". */
export const signOff = (x: Tools, name?: string) =>
  b.signOff(x.t('common.regards'), name ?? x.t('common.signature'));

/** Button, expiry chip and the written-out link, in board order. */
export function action(x: Tools, label: string, href: string, expiry: string | null): b.Block[] {
  return [
    b.button(label, href),
    ...(expiry ? [b.expiry(expiry, x.assets)] : []),
    b.fallbackLink(x.t('common.fallback'), href),
  ];
}

export { b };
