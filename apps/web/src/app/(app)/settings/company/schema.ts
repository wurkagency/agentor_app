import { parseCvr } from '@agentor/core';
import { z } from 'zod';

/** Shared by the form (client) and the action (server): one source of validation. */
export const companySchema = z.object({
  name: z.string().trim().min(2, 'name').max(160),
  // "DK 12 34 56 74" is stored as "12345674"; a mistyped number fails modulus 11 (parseCvr).
  cvr: z.string().transform((v, ctx) => {
    if (v.trim() === '') return '';
    const r = parseCvr(v);
    if (r.ok) return r.cvr;
    ctx.addIssue({ code: 'custom', message: r.reason === 'format' ? 'cvr' : `cvr_${r.reason}` });
    return z.NEVER;
  }),
  addressLine: z.string().trim().max(200),
  postalCode: z.string().trim().max(10),
  city: z.string().trim().max(100),
  billingEmail: z.union([z.literal(''), z.email('email').max(254)]),
  locale: z.enum(['da', 'en']),
  timeZone: z.enum([
    'Europe/Copenhagen',
    'Europe/Stockholm',
    'Europe/Oslo',
    'Europe/Berlin',
    'Europe/London',
  ]),
  currency: z.enum(['DKK', 'EUR', 'SEK', 'NOK']),
});

export type CompanyForm = z.input<typeof companySchema>;
