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
): Promise<{ subject: string; text: string }> {
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
        };
        return { subject: full.Subject, text: full.Text };
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No mail to ${address} within ${timeoutMs} ms`);
}
