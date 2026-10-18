'use client';

import { passkeyClient } from '@better-auth/passkey/client';
import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Browser auth client. Same origin as the app; the server never trusts anything else (§9.5). */
export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.assign('/login/mfa');
      },
    }),
    passkeyClient(),
  ],
});
