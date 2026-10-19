'use client';

import { Button, cn, ConnectorLogo, Icon } from '@agentor/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { RadioGroup as RadioPrimitive } from 'radix-ui';
import { useState, useTransition } from 'react';
import { finishOnboarding } from '../actions';
import { TEMPLATE_LOGOS, TEMPLATES, type TemplateId } from '../options';

const NAMES: Record<string, string> = {
  woocommerce: 'WooCommerce',
  shopify: 'Shopify',
  dinero: 'Dinero',
  economic: 'e-conomic',
  hubspot: 'HubSpot',
  brevo: 'Brevo',
};

export function TemplateStep() {
  const t = useTranslations('onboarding');
  const [template, setTemplate] = useState<TemplateId>('webshop-dinero');
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<'start' | 'skip' | null>(null);

  const finish = (choice: TemplateId | null) => {
    setWhich(choice ? 'start' : 'skip');
    start(() => finishOnboarding(choice));
  };

  return (
    <div className="flex flex-col gap-5">
      <RadioPrimitive.Root
        value={template}
        onValueChange={(v) => setTemplate(v as TemplateId)}
        aria-label={t('flowTitle')}
        className="grid gap-3 md:grid-cols-3"
      >
        {TEMPLATES.map((id) => {
          const [from, to] = TEMPLATE_LOGOS[id];
          return (
            <RadioPrimitive.Item
              key={id}
              value={id}
              className={cn(
                'flex cursor-pointer flex-col gap-3 rounded-node border-0 bg-surface p-4 text-left shadow-ring-chip',
                'data-[state=checked]:shadow-ring-dark-2',
              )}
            >
              <span className="flex items-center gap-2" aria-hidden>
                <ConnectorLogo
                  size={24}
                  connector={{ name: NAMES[from]!, logoUrl: `/logos/${from}.svg` }}
                />
                <Icon icon={ArrowRight} size={14} className="text-fg-2" />
                <ConnectorLogo
                  size={24}
                  connector={{ name: NAMES[to]!, logoUrl: `/logos/${to}.svg` }}
                />
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-body font-semibold">{t(`templates.${id}.title`)}</span>
                <span className="text-table text-fg-2">{t(`templates.${id}.body`)}</span>
              </span>
            </RadioPrimitive.Item>
          );
        })}
      </RadioPrimitive.Root>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/onboarding/plan"
          className="flex items-center gap-1.5 text-table font-semibold text-fg-1"
        >
          <Icon icon={ArrowLeft} size={14} />
          {t('back')}
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="m"
            onClick={() => finish(null)}
            loading={pending && which === 'skip'}
            disabled={pending}
          >
            {t('skip')}
          </Button>
          <Button
            variant="primary"
            size="l"
            onClick={() => finish(template)}
            loading={pending && which === 'start'}
            disabled={pending}
          >
            {t('startSetup')}
          </Button>
        </div>
      </div>
    </div>
  );
}
