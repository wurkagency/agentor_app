import { z } from 'zod';

/** Shared by the form (client) and the action (server): one source of validation. */
export const companySchema = z.object({
  name: z.string().trim().min(2, 'name').max(160),
  cvr: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, ''))
    .refine((v) => v === '' || /^\d{8}$/.test(v), 'cvr'),
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
