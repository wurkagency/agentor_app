import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';

// Downloaded at build time and served from our own origin: no runtime call to Google (EU data).
export const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-jetbrains',
  display: 'swap',
});
