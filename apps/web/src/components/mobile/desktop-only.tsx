import { Responsive } from '@agentor/ui/mobile';
import type { ReactNode } from 'react';
import { DeskOnly, type DeskArea } from './desk-only';

/**
 * Layout wrapper for a desktop-only route (README decision 20): the page as usual from 768 px,
 * the "computer" screen with "Send link til min computer" below.
 */
export function DesktopOnly({
  area,
  title,
  platform = false,
  children,
}: {
  area: DeskArea;
  title: string;
  platform?: boolean;
  children: ReactNode;
}) {
  return (
    <Responsive
      desktop={children}
      mobile={<DeskOnly area={area} title={title} platform={platform} />}
    />
  );
}
