import { z } from 'zod';

/**
 * Server environment, validated once. Names are documented in .env.example; values come from
 * .env.local in development and the 0400 env file in production (produktspecifikation §10.5).
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL_WEB: z.string().min(1),
  REDIS_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  /** Mailpit locally when unset; required in production (no silent default there). */
  SMTP_URL: z.string().min(1).optional(),
  MAIL_FROM: z.string().default('Agentor <no-reply@agentor.dk>'),
  QUICKPAY_MODE: z.enum(['mock', 'test', 'live']).default('mock'),
  QUICKPAY_API_KEY: z.string().optional(),
  /** Only the mock checkout signs callbacks in the web process; real ones come from QuickPay. */
  QUICKPAY_PRIVATE_KEY: z.string().optional(),
  /** Where the web process reaches agentor-ingest (mock checkout only). */
  INGEST_INTERNAL_URL: z.url().default('http://127.0.0.1:3100'),
  /** Public base URL of agentor-ingest, given to QuickPay as callback host. */
  INGEST_PUBLIC_URL: z.url().default('http://127.0.0.1:3100'),
  /** The KEK's public half; the web process can seal credentials but never open them. */
  KEK_PUBLIC_KEY: z.string().optional(),
  CONNECTOR_MODE: z.enum(['mock', 'live']).default('mock'),
  CVR_PROVIDER: z.enum(['fixture', 'virkdata']).default('fixture'),
  VIRKDATA_API_KEY: z.string().optional(),
  /** Web Push (PLAN-MOBILE M3): the public half goes to browsers; without it push is off. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  /**
   * Sign-up and login with Google and Microsoft (PLAN-SIGNUP §5). `off` hides the buttons,
   * `mock` uses the local test identity provider (/dev/oauth, refused in production), `live`
   * the real providers with the client ids below.
   */
  SSO_MODE: z.enum(['off', 'mock', 'live']).default('off'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  /**
   * Terms accepted on the payment step, served from agentor.dk (PLAN-SIGNUP B6, B12). The
   * version is read from the page when the owner accepts. FOLLOW-UP (T3): real URLs.
   */
  LEGAL_SUBSCRIPTION_TERMS_URL: z.url().optional(),
  LEGAL_PRIVACY_URL: z.url().optional(),
  LEGAL_DPA_URL: z.url().optional(),
  /** Development and tests only: the version used while agentor.dk has no documents yet. */
  LEGAL_DEV_VERSION: z.string().max(80).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid server environment: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => env().NODE_ENV === 'production';
