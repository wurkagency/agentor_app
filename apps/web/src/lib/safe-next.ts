/**
 * Only same-origin, absolute paths are allowed as post-login targets: "/invite/abc" yes;
 * "//evil.example", "https://…" or "/\evil" no (open-redirect protection).
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
    return '/';
  if (/[\r\n]/.test(value)) return '/';
  return value;
}

const KEY = 'agentor:next';

export function rememberNext(next: string) {
  try {
    sessionStorage.setItem(KEY, safeNext(next));
  } catch {
    // Private mode: fall back to "/".
  }
}

export function takeNext(): string {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return safeNext(v);
  } catch {
    return '/';
  }
}
