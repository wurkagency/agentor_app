import { getUserById, hasEarlierSessionFromAgent } from '@agentor/db';
import { formatDateTime } from '@agentor/i18n';
import { db } from '../infra';
import { sendMail } from '../mail';

/** Short, human description of a user agent: "Chrome på Windows". No full UA string in mail. */
export function describeAgent(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'en browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'en ukendt enhed';
  return `${browser} på ${os}`;
}

/**
 * Notification on sign-in from a new device (produktspecifikation §9.5). Sent only when the
 * user has signed in before, and never from this user agent.
 */
export async function notifyNewDevice(session: {
  id: string;
  userId: string;
  userAgent?: string | null | undefined;
}) {
  const ua = session.userAgent ?? '';
  if (!ua) return;
  const { seenAgent, anyEarlier } = await hasEarlierSessionFromAgent(
    db(),
    session.userId,
    ua,
    session.id,
  );
  if (seenAgent || !anyEarlier) return;
  const user = await getUserById(db(), session.userId);
  if (!user) return;
  await sendMail({
    to: user.email,
    subject: 'Nyt login på din Agentor-konto',
    text: `Hej ${user.name}\n\nDin konto blev brugt til at logge ind fra ${describeAgent(ua)} ${formatDateTime(new Date())}.\n\nVar det dig, skal du ikke gøre noget. Var det ikke dig, så skift din adgangskode og log ud overalt under Indstillinger → Sikkerhed.\n\nVenlig hilsen\nAgentor`,
  });
}
