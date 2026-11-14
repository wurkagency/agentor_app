import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import globalSetup from './global-setup';
import { TENANTS } from '../scripts/seed-data';
import { latestMailTo } from './mailpit';
import {
  adminQuery,
  base32Decode,
  fillPassword,
  fullLogin,
  login,
  SEED_PASSWORD,
  totp,
  USERS,
} from './support';

// Profile dashboard (README decision 25, PLAN-2026-10-21 M3): the user's own profile only, the
// avatar processed on the server, and every security change through Better Auth and audit-logged.
test.describe.configure({ mode: 'serial' });

/** A 600 × 600 JPEG with EXIF (camera and GPS) that must not survive the upload. */
async function photoWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 600, height: 600, channels: 3, background: '#d0e84a' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestCam', Model: 'E2E' }, IFD3: { GPSLatitudeRef: 'N' } })
    .toBuffer();
}

async function upload(page: Page, file: Buffer, name = 'photo.jpg', mimeType = 'image/jpeg') {
  // The input's change handler exists only once React has hydrated the page.
  await page.waitForLoadState('networkidle');
  await page
    .getByTestId('avatar-file')
    .filter({ visible: false })
    .first()
    .setInputFiles({ name, mimeType, buffer: file });
}

test('upload an avatar: WebP 512 × 512, no EXIF, the old file replaced, audit-logged', async ({
  page,
}) => {
  await login(page, 'mette');
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Mette Holm', level: 1 }).first()).toBeVisible();

  const before = await adminQuery<{ n: number }>(
    `select count(*)::int as n from audit_log where action = 'profile.avatar_changed' and actor_user_id = $1`,
    [USERS.mette.id],
  );
  await upload(page, await photoWithExif());
  await expect(page.getByText('Dit profilbillede er gemt').filter({ visible: true })).toBeVisible();
  const [first] = await adminQuery<{ key: string }>(
    `select avatar_key as key from user_profiles where user_id = $1`,
    [USERS.mette.id],
  );
  expect(first!.key).toMatch(/^avatars\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/);

  const res = await page.request.get(`/api/avatar/${USERS.mette.id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/webp');
  expect(res.headers()['cache-control']).toContain('private');
  const meta = await sharp(Buffer.from(await res.body())).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
  expect(meta.exif).toBeUndefined();

  // A second photo replaces the first; the old file is gone from the storage area.
  const second = await sharp({
    create: { width: 300, height: 300, channels: 3, background: '#13293a' },
  })
    .png()
    .toBuffer();
  await upload(page, second, 'photo.png', 'image/png');
  const keyNow = async () =>
    (
      await adminQuery<{ key: string }>(
        `select avatar_key as key from user_profiles where user_id = $1`,
        [USERS.mette.id],
      )
    )[0]!.key;
  await expect.poll(keyNow).not.toBe(first!.key);
  const now = { key: await keyNow() };
  const { existsSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const root = process.env.STORAGE_DIR ?? resolve(process.cwd(), '../../.data/storage');
  expect(existsSync(resolve(root, first!.key))).toBe(false);
  expect(existsSync(resolve(root, now.key))).toBe(true);

  // Too small and not an image are refused on the server.
  const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  await upload(page, tiny, 'tiny.png', 'image/png');
  await expect(
    page.getByText('mindst 256 × 256 px.').filter({ visible: true }).first(),
  ).toBeVisible();
  await upload(page, Buffer.from('not an image at all'), 'fake.png', 'image/png');
  await expect(
    page.getByText('Billedet skal være PNG eller JPG.').filter({ visible: true }),
  ).toBeVisible();

  const after = await adminQuery<{ n: number }>(
    `select count(*)::int as n from audit_log where action = 'profile.avatar_changed' and actor_user_id = $1`,
    [USERS.mette.id],
  );
  expect(after[0]!.n - before[0]!.n).toBe(2);
});

test('the avatar is only served to the user, colleagues and staff seeing staff', async ({
  browser,
}) => {
  const jonas = await (await browser.newContext()).newPage();
  await login(jonas, 'jonas');
  // Jonas is Mette's colleague in Nordlys Cykler.
  expect((await jonas.request.get(`/api/avatar/${USERS.mette.id}`)).status()).toBe(200);
  await jonas.context().close();
  // A user in another company, and staff (even with a support grant), get 404.
  const bo = await (await browser.newContext()).newPage();
  await login(bo, 'bo');
  const shares = await adminQuery<{ n: number }>(
    `select count(*)::int as n from memberships a join memberships b on b.tenant_id = a.tenant_id
      where a.user_id = $1 and b.user_id = $2`,
    [USERS.bo.id, USERS.mette.id],
  );
  if (shares[0]!.n === 0)
    expect((await bo.request.get(`/api/avatar/${USERS.mette.id}`)).status()).toBe(404);
  await bo.context().close();
  const anne = await (await browser.newContext()).newPage();
  await login(anne, 'anne');
  expect((await anne.request.get(`/api/avatar/${USERS.mette.id}`)).status()).toBe(404);
  expect((await anne.request.get('/api/avatar/not-a-uuid')).status()).toBe(404);
  await anne.context().close();
});

test('a supporter in a customer support view gets no customer profile', async ({ browser }) => {
  // Its own session, so the support view doesn't follow the cached login into other tests.
  const page = await (await browser.newContext()).newPage();
  await fullLogin(page, 'anne');
  await page.goto(`/platform/customers/${TENANTS.nordlys.id}`);
  await page.getByRole('button', { name: 'Åbn kundens app' }).click();
  await expect(page.getByRole('region', { name: 'Supportvisning' })).toBeVisible();
  // Neither Mette's profile page nor her photo opens through support access.
  await page.goto('/profile');
  await expect(
    page.getByText('Du har ikke adgang til denne side').filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: USERS.mette.name })).toHaveCount(0);
  const avatar = await page.request.get(`/api/avatar/${USERS.mette.id}`);
  expect(avatar.status()).toBe(404);
  await page.context().close();
});

test('personal details save to the signed-in user only', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/profile');
  const card = page.locator('#oplysninger');
  await card.getByLabel('Telefon').fill('+45 12 34 56 78');
  await card.getByLabel('By').fill('Aarhus');
  await card.getByRole('button', { name: 'Gem ændringer' }).click();
  await expect(page.getByText('Dine oplysninger er gemt').filter({ visible: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#oplysninger').getByLabel('By')).toHaveValue('Aarhus');
  await expect(page.getByText('Dansk · Aarhus').first()).toBeVisible();
  const rows = await adminQuery<{ user_id: string }>(
    `select user_id from user_profiles where city = 'Aarhus'`,
  );
  expect(rows.map((r) => r.user_id)).toEqual([USERS.mette.id]);
  // The customer's role comes from the membership and is read-only.
  await expect(page.locator('#oplysninger').getByLabel('Rolle i virksomheden')).toHaveAttribute(
    'readonly',
    '',
  );
});

test('TOTP on and off, and a passkey added, for a customer the company lets choose', async ({
  page,
}) => {
  await login(page, 'bo');
  await page.goto('/profile');
  const security = page.locator('#sikkerhed');
  // On: the existing setup flow.
  await security.getByRole('switch', { name: 'Totrinsbekræftelse' }).click();
  await expect(page).toHaveURL(/\/login\/mfa\/setup$/);
  // The setup form submits through React; wait for it to hydrate (first compile in dev is slow).
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Bekræft med din adgangskode').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Fortsæt' }).click();
  const secret = await page.locator('.font-mono').first().innerText();
  await page
    .getByLabel('Skriv den 6-cifrede kode fra appen')
    .fill(await totp(base32Decode(secret.trim())));
  await page.getByRole('button', { name: 'Slå til' }).click();
  await page.getByRole('button', { name: 'Jeg har gemt koderne' }).click();
  await page.goto('/profile');
  await expect(security.getByRole('switch', { name: 'Totrinsbekræftelse' })).toBeChecked();

  // Off: needs the password.
  await security.getByRole('switch', { name: 'Totrinsbekræftelse' }).click();
  const off = page.getByRole('dialog', { name: 'Slå totrin fra' });
  await off.getByLabel('Nuværende adgangskode').fill(SEED_PASSWORD);
  await off.getByRole('button', { name: 'Slå fra' }).click();
  await expect(page.getByText('Totrin er slået fra').filter({ visible: true })).toBeVisible();
  await expect(security.getByRole('switch', { name: 'Totrinsbekræftelse' })).not.toBeChecked();

  // A passkey with a virtual authenticator.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  await security.getByRole('button', { name: 'Tilføj passkey' }).click();
  await expect(page.getByText('Din passkey er tilføjet').filter({ visible: true })).toBeVisible();

  const audit = await adminQuery<{ action: string }>(
    `select action from audit_log where actor_user_id = $1 and action like 'security.%'
      and created_at > now() - interval '5 minutes' order by created_at`,
    [USERS.bo.id],
  );
  expect(audit.map((a) => a.action)).toEqual([
    'security.two_factor_enabled',
    'security.two_factor_disabled',
    'security.passkey_added',
  ]);
});

test('staff can never turn two-step login off', async ({ page }) => {
  await login(page, 'anne');
  await page.goto('/platform/profile');
  await expect(
    page.locator('#sikkerhed').getByRole('switch', { name: 'Totrinsbekræftelse' }),
  ).toBeDisabled();
  // And the server refuses it as well.
  const res = await page.request.post('/api/auth/two-factor/disable', {
    data: { password: SEED_PASSWORD },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(res.status()).toBe(403);
});

/** Sara's password after the password test; the seed is restored at the end of the file. */
const NEW_PASSWORD = 'Et-helt-nyt-kodeord-2026!';

test('change password and sign out the other sessions', async ({ browser }) => {
  const other = await (await browser.newContext()).newPage();
  await login(other, 'sara');
  const page = await (await browser.newContext()).newPage();
  await fillPassword(page, USERS.sara.email);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/profile');
  await page.locator('#sikkerhed').getByRole('button', { name: 'Skift adgangskode' }).click();
  const dialog = page.getByRole('dialog', { name: 'Skift adgangskode' });
  await dialog.getByLabel('Nuværende adgangskode').fill(SEED_PASSWORD);
  await dialog.getByLabel('Ny adgangskode').fill(NEW_PASSWORD);
  await expect(dialog.getByRole('switch', { name: 'Log ud på alle andre enheder' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Gem' }).click();
  await expect(page.getByText('Din adgangskode er ændret').filter({ visible: true })).toBeVisible();
  // The other device is signed out; this one isn't.
  await other.goto('/');
  await expect(other).toHaveURL(/\/login/);
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/profile$/);
  const audit = await adminQuery(
    `select 1 from audit_log where actor_user_id = $1 and action = 'security.password_changed'
        and after->>'revokedOtherSessions' = 'true'`,
    [USERS.sara.id],
  );
  expect(audit.length).toBe(1);
  await other.context().close();
  await page.context().close();
});

test('change the login e-mail with a code sent to the new address', async ({ page }) => {
  await fillPassword(page, USERS.sara.email, NEW_PASSWORD);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/profile');
  await page.locator('#sikkerhed').getByRole('button', { name: 'Skift e-mail' }).click();
  const dialog = page.getByRole('dialog', { name: 'Skift e-mail' });
  const next = `sara+${Date.now()}@lind-dev.dk`;
  await dialog.getByLabel('Ny e-mail').fill(next);
  await dialog.getByRole('button', { name: 'Send kode' }).click();
  const mail = await latestMailTo(next);
  const code = /\b(\d{6})\b/.exec(mail.text)![1]!;
  await dialog.getByLabel('Kode').fill(code);
  await dialog.getByRole('button', { name: 'Bekræft' }).click();
  await expect(
    page.getByText('Din login-e-mail er skiftet').filter({ visible: true }),
  ).toBeVisible();
  const [u] = await adminQuery<{ email: string }>(`select email from auth.users where id = $1`, [
    USERS.sara.id,
  ]);
  expect(u!.email).toBe(next);
  const notice = await latestMailTo(USERS.sara.email);
  expect(notice.subject).toBe('Din login-e-mail hos Agentor er ændret');
});

test('restore the seed after the account changes above', () => {
  globalSetup();
});
