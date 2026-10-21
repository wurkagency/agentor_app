import { getUserById, hasEarlierSessionFromAgent } from '@agentor/db';
import { db } from '../infra';
import { sendEmail } from '../mail';

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
  // E03: deliberately no button and no link. The app has no IP geolocation, so no place.
  await sendEmail(
    'new-device-login',
    { name: user.name, email: user.email, device: describeAgent(ua), place: null, at: new Date() },
    { to: user.email, entityRef: `session-${session.id}` },
  );
}
