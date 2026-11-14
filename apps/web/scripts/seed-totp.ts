/**
 * Prints the current two-step code for the seeded test users (local development only).
 *
 *   pnpm --filter @agentor/web exec tsx scripts/seed-totp.ts
 */
import { createOTP } from '@better-auth/utils/otp';
import { SEED_TOTP_SECRET } from './seed-data';

console.log(await createOTP(SEED_TOTP_SECRET, { digits: 6, period: 30 }).totp());
