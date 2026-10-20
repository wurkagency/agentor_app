import type { MetadataRoute } from 'next';

/**
 * Web app manifest (PLAN-MOBILE M3): installable from the browser, opens standalone at
 * Overblik. Icons from docs/assets/favicon.svg and the brand mark (B9).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Agentor',
    short_name: 'Agentor',
    description: 'Hold øje med dine integrationer, og ret fejl, når du er væk fra computeren.',
    lang: 'da',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Lime brand colour (--color-primary) and the app canvas (--color-canvas).
    theme_color: '#D0E84A',
    background_color: '#F7F5F1',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
