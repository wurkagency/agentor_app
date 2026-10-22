import { describe, expect, it } from 'vitest';
import { createMailer, recipientHash, SAMPLES, SAMPLE_NOW } from '../src/index.js';

type Sent = Record<string, unknown>;

function fakeTransport(failures: unknown[] = []) {
  const sent: Sent[] = [];
  let calls = 0;
  return {
    sent,
    get calls() {
      return calls;
    },
    transport: {
      sendMail: async (m: Sent) => {
        calls++;
        const f = failures.shift();
        if (f) throw f;
        sent.push(m);
        return { messageId: `<m${calls}@test>` };
      },
    },
  };
}

function memoryLog() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  return {
    lines,
    log: {
      info: (obj: Record<string, unknown>, msg: string) => lines.push({ level: 'info', obj, msg }),
      warn: (obj: Record<string, unknown>, msg: string) => lines.push({ level: 'warn', obj, msg }),
    },
  };
}

const base = { from: 'Agentor <no-reply@agentor.dk>', appUrl: 'https://app.agentor.dk' };

describe('sendEmail', () => {
  it('sends HTML and text with the subject, Reply-To and an entity id', async () => {
    const t = fakeTransport();
    const send = createMailer({ ...base, transport: t.transport as never, backoffMs: [0] });
    const res = await send('case-resolved', SAMPLES['case-resolved'], {
      to: 'mette@nordlys-cykler.dk',
      replyTo: 'sag+abc@svar.agentor.dk',
      entityRef: 'case-2291',
      now: SAMPLE_NOW,
    });
    expect(res.messageId).toBe('<m1@test>');
    const m = t.sent[0]!;
    expect(m.subject).toBe('Løst: Fakturaer til EU-kunder fejler (sag #2291)');
    expect(m.replyTo).toBe('sag+abc@svar.agentor.dk');
    expect(String(m.html)).toContain('<!doctype html>');
    expect(String(m.text)).toContain('Din sag er løst');
    expect(m.headers).toEqual({ 'X-Entity-Ref-ID': 'case-2291' });
  });

  it('adds List-Unsubscribe headers for one-click unsubscribe (E22)', async () => {
    const t = fakeTransport();
    const send = createMailer({ ...base, transport: t.transport as never });
    await send('weekly-summary', SAMPLES['weekly-summary'], {
      to: 'mette@nordlys-cykler.dk',
      unsubscribeUrl: 'https://app.agentor.dk/unsubscribe?t=x',
    });
    expect(t.sent[0]!.headers).toEqual({
      'List-Unsubscribe': '<https://app.agentor.dk/unsubscribe?t=x>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('retries transient failures and then succeeds', async () => {
    const t = fakeTransport([
      Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('busy'), { responseCode: 421 }),
    ]);
    const l = memoryLog();
    const send = createMailer({
      ...base,
      transport: t.transport as never,
      log: l.log,
      backoffMs: [0, 0, 0],
    });
    await send('signup-code', SAMPLES['signup-code'], { to: 'mette@nordlys-cykler.dk' });
    expect(t.calls).toBe(3);
    expect(l.lines.map((x) => x.msg)).toEqual(['email retry', 'email retry', 'email sent']);
  });

  it('does not retry a permanent rejection', async () => {
    const t = fakeTransport([Object.assign(new Error('no such user'), { responseCode: 550 })]);
    const send = createMailer({ ...base, transport: t.transport as never, backoffMs: [0, 0] });
    await expect(
      send('signup-code', SAMPLES['signup-code'], { to: 'x@example.com' }),
    ).rejects.toThrow('no such user');
    expect(t.calls).toBe(1);
  });

  it('logs the template, a recipient hash and the message id, never the code or the address', async () => {
    const t = fakeTransport();
    const l = memoryLog();
    const send = createMailer({ ...base, transport: t.transport as never, log: l.log });
    await send('signup-code', SAMPLES['signup-code'], { to: 'Mette@Nordlys-Cykler.dk' });
    const logged = JSON.stringify(l.lines);
    expect(logged).not.toContain('730416');
    expect(logged).not.toContain('nordlys');
    expect(logged).not.toContain('Nordlys');
    expect(l.lines[0]!.obj).toEqual({
      template: 'signup-code',
      to: recipientHash('mette@nordlys-cykler.dk'),
      messageId: '<m1@test>',
      attempt: 1,
    });
    expect(recipientHash('mette@nordlys-cykler.dk')).toMatch(/^[0-9a-f]{12}$/);
  });
});
