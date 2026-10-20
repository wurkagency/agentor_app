'use client';

import { BigButton } from '@agentor/ui/mobile';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStandalone } from '@/components/mobile/standalone';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SEEN = 'agentor:install-guide-done';

/**
 * MA13 actions: Chrome's own install prompt when the browser offers one (Android), and "Jeg har
 * gjort det", which remembers the guide was followed on this device and returns to Mere.
 */
export function InstallActions() {
  const t = useTranslations('mobile.install');
  const router = useRouter();
  const standalone = useStandalone();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  useEffect(() => {
    // Already running from the home screen: the guide has nothing to do.
    if (standalone) router.replace('/more');
  }, [standalone, router]);
  return (
    <div className="mt-auto flex flex-col gap-2">
      {prompt && (
        <BigButton
          variant="dark"
          icon={Download}
          onClick={async () => {
            await prompt.prompt();
            setPrompt(null);
          }}
        >
          {t('installNow')}
        </BigButton>
      )}
      <BigButton
        onClick={() => {
          try {
            localStorage.setItem(SEEN, new Date().toISOString());
          } catch {
            // Private mode: nothing to remember.
          }
          router.push('/more');
        }}
      >
        {t('done')}
      </BigButton>
    </div>
  );
}
