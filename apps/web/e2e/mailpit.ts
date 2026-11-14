/** Reads mail captured by Mailpit (docker compose locally, service container in CI). */
const API = process.env.MAILPIT_API ?? 'http://127.0.0.1:58025/api/v1';

interface Summary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Created: string;
}

export async function latestMailTo(
  address: string,
  timeoutMs = 10_000,
): Promise<{ id: string; subject: string; text: string; html: string; replyTo: string[] }> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const res = await fetch(`${API}/messages?limit=50`);
    if (res.ok) {
      const { messages } = (await res.json()) as { messages: Summary[] };
      const hit = messages.find((m) =>
        m.To.some((t) => t.Address.toLowerCase() === address.toLowerCase()),
      );
      if (hit) {
        const full = (await (await fetch(`${API}/message/${hit.ID}`)).json()) as {
          Subject: string;
          Text: string;
          HTML: string;
          ReplyTo: { Address: string }[] | null;
        };
        return {
          id: hit.ID,
          subject: full.Subject,
          // Danish amounts use a no-break space before "kr."; compare with plain spaces.
          text: full.Text.replace(/[\u00a0\u202f]/g, ' '),
          html: full.HTML,
          replyTo: (full.ReplyTo ?? []).map((r) => r.Address),
        };
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No mail to ${address} within ${timeoutMs} ms`);
}

/** Subjects of all captured mails to an address, newest first. */
export async function subjectsTo(address: string): Promise<string[]> {
  const res = await fetch(`${API}/messages?limit=200`);
  if (!res.ok) return [];
  const { messages } = (await res.json()) as { messages: Summary[] };
  return messages
    .filter((m) => m.To.some((t) => t.Address.toLowerCase() === address.toLowerCase()))
    .map((m) => m.Subject);
}

/** The raw headers of one message (List-Unsubscribe, X-Entity-Ref-ID …). */
export async function headersOf(id: string): Promise<Record<string, string[]>> {
  const res = await fetch(`${API}/message/${id}/headers`);
  return (await res.json()) as Record<string, string[]>;
}

/** How many captured mails to an address have a subject matching the pattern. */
export async function countTo(address: string, subject: RegExp): Promise<number> {
  return (await subjectsTo(address)).filter((s) => subject.test(s)).length;
}
