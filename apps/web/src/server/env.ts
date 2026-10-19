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
  SMTP_URL: z.string().min(1).default('smtp://127.0.0.1:51025'),
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
  CVR_PROVIDER: z.enum(['fixture', 'datafordeler']).default('fixture'),
  DATAFORDELER_API_KEY: z.string().optional(),
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
