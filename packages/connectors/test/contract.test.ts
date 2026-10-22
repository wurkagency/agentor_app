import { adapterFor, manifestFor } from '../src/index.js';
import { adapterContract } from './contract.js';

// The mock adapters pass the contract every real adapter must pass before it ships.
for (const id of ['woocommerce', 'dinero']) {
  const manifest = manifestFor(id);
  if (manifest)
    adapterContract(`mock ${id}`, manifest, (credentials = {}) =>
      adapterFor({ connectorId: id, credentials, mode: 'mock' }),
    );
}
