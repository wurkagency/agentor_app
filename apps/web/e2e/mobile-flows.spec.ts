import { pushUrl } from '@agentor/core';
import { createDatabase, requestAccess } from '@agentor/db';
import { expect, test, type Page } from '@playwright/test';
import { FLOWS, TENANTS, USERS } from '../scripts/seed-data';
import { login } from './support';

/**
 * PLAN-MOBILE e2e paths at phone size:
 * - push → MA12 → approve support access, visible in the customer's audit log;
 * - MA03 → MA06 → retry;
 * - offline: the last overview from this device, with the grey banner.
 */
test.describe.configure({ mode: 'serial' });

async function swReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

test('@mobile push → MA12 → approve, logged in the customer’s audit log', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['notifications']);
  await login(page, 'mette');
  await page.goto('/');
  await swReady(page);

  // Line from Agentor support asks for access to Nordlys (the Platform action P3 uses).
  const handle = createDatabase(process.env.DATABASE_URL_WEB!, { max: 1 });
  let grantId: string;
  try {
    ({ grantId } = await requestAccess(
      handle.db,
      { userId: USERS.line.id, name: USERS.line.name, role: 'supporter' },
      {
        tenantId: TENANTS.nordlys.id,
        caseId: null,
        reason: 'E2E mobil: hjælpe med kreditnotaer',
        hours: 1,
        scope: 'view',
      },
    ));
  } finally {
    await handle.close();
  }

  // The push as the worker sends it for "supportRequested" (MA14), delivered to the service worker.
  const payload = {
    title: 'Agentor support beder om adgang',
    body: 'Line vil hjælpe i 1 time. Godkend eller afvis.',
    url: pushUrl('/settings/security#support', { grantId }),
    tag: `e2e:${grantId}`,
  };
  // The open app hears every push from the service worker (it shows the notification too, but
  // headless Chromium never grants notification permission, so the message is what we can read).
  await page.evaluate(() => {
    const w = window as unknown as { __push?: Promise<unknown> };
    w.__push = new Promise((resolve) =>
      navigator.serviceWorker.addEventListener('message', (e) => resolve(e.data)),
    );
  });
  const cdp = await context.newCDPSession(page);
  const registration = new Promise<string>((resolve) =>
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
      const r = e.registrations.find(
        (x) => !x.isDeleted && x.scopeURL.startsWith(new URL(page.url()).origin),
      );
      if (r) resolve(r.registrationId);
    }),
  );
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: new URL(page.url()).origin,
    registrationId: await registration,
    data: JSON.stringify(payload),
  });
  const message = await page.evaluate(
    () =>
      (window as unknown as { __push: Promise<{ type: string; title: string; url: string }> })
        .__push,
  );
  expect(message).toMatchObject({
    type: 'agentor:push',
    title: payload.title,
    url: `/support-access/${grantId}`,
  });

  // Tapping the notification opens its url (the service worker's notificationclick).
  await page.goto(message.url);
  await expect(
    page.getByText('Line fra Agentor support beder om adgang').filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Højst 1 time · du kan stoppe den når som helst').filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Godkend' }).filter({ visible: true }).click();
  await expect(page.getByText('Adgangen er godkendt i 1 time')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/settings/audit-log?group=support');
  await expect(page.getByText('Godkendte supportadgang').first()).toBeVisible();
});

test('@mobile MA03 → MA06 → retry the failed orders', async ({ page }) => {
  await login(page, 'mette');
  await page.goto('/');
  const problem = page
    .getByRole('link', { name: /ordrer blev ikke bogført/ })
    .filter({ visible: true });
  await problem.first().click();
  await expect(page).toHaveURL(new RegExp(`/integrations/${FLOWS.webshop.id}/runs/`));
  await expect(page.getByText('Hvorfor').filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: /^Gentag \d+ ordrer?$/ }).click();
  await expect(page.getByText('Gentagelsen er startet')).toBeVisible();
});

test('@mobile offline shows the last overview with the grey banner', async ({ page, context }) => {
  await login(page, 'mette');
  await page.goto('/');
  await swReady(page);
  await expect(page.getByText('Records i dag').filter({ visible: true })).toBeVisible();
  // The snapshot is written after render; give it a moment, then go offline.
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.goto('/integrations').catch(() => undefined);
  await expect(page.getByText(/^Offline · data fra kl\. \d{2}[.:]\d{2}$/)).toBeVisible();
  await expect(page.getByText('Nordlys Cykler ApS')).toBeVisible();
  await expect(page.getByText('Handlinger er slået fra, til du er online igen.')).toBeVisible();
  await context.setOffline(false);
});
