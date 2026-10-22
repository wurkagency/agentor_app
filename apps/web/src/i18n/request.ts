import da from '@agentor/i18n/messages/da.json';
import en from '@agentor/i18n/messages/en.json';
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const LOCALE_COOKIE = 'agentor-locale';
const catalogs = { da, en } as const;

/**
 * Danish by default; English when the user picked it (profile menu "Sprog"). No locale in the
 * URL: routes stay the same for every language (produktspecifikation §6).
 */
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = value === 'en' ? 'en' : 'da';
  return { locale, messages: catalogs[locale], timeZone: 'Europe/Copenhagen' };
});
