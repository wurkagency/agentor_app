import { getBillingOverview } from '@agentor/db';
import { cache } from 'react';
import type { AppContext } from './auth/session';
import { db } from './infra';

/** Billing overview once per request (header meter, profile menu and the page itself). */
export const billingOverviewFor = cache((tenantId: string, userId: string) =>
  getBillingOverview(db(), { tenantId, userId }),
);

export const billingOverview = (ctx: AppContext) =>
  billingOverviewFor(ctx.tenant.tenantId, ctx.user.id);
