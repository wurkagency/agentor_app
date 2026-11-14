import { ArrowRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { Icon } from './icon';

export interface ConnectorRef {
  /** Display name, used for alt text and the initials fallback. */
  name: string;
  /** Logo URL from the connector manifest. */
  logoUrl?: string | undefined;
}

const SIZE = {
  24: 'size-6 rounded-xs text-nano',
  32: 'size-8 rounded-sm text-meta',
  48: 'size-12 rounded-sm text-card',
} as const;

function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

/**
 * Connector logo in a white square with a 1 px line (§2.6). Without a logo the fallback is
 * initials 600 on bg-base (e.g. "BC" for Business Central, README "Kendte pladsholdere").
 */
export function ConnectorLogo({
  connector,
  size = 32,
  className,
}: {
  connector: ConnectorRef;
  size?: 24 | 32 | 48;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'grid flex-none place-items-center box-border border border-border font-semibold text-fg-1',
        connector.logoUrl ? 'bg-white' : 'bg-bg-base',
        SIZE[size],
        className,
      )}
    >
      {connector.logoUrl ? (
        // Logos are tiny static SVGs from the catalogue; an optimised image adds nothing here.
        <img
          src={connector.logoUrl}
          alt={connector.name}
          className="block size-3/4 object-contain"
        />
      ) : (
        <span aria-label={connector.name} role="img">
          {initials(connector.name)}
        </span>
      )}
    </span>
  );
}

/** Source → up to 4 overlapping destination logos and "+N" (designspecifikation §4). */
export function ConnectorPair({
  source,
  destinations,
  size = 32,
  max = 4,
  className,
}: {
  source: ConnectorRef;
  destinations: ConnectorRef[];
  size?: 24 | 32;
  max?: number;
  className?: string;
}) {
  const shown = destinations.slice(0, max);
  const rest = destinations.length - shown.length;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <ConnectorLogo connector={source} size={size} />
      <Icon icon={ArrowRight} size={14} className="text-fg-3" />
      <span className="inline-flex">
        {shown.map((d, i) => (
          <ConnectorLogo
            key={`${d.name}-${i}`}
            connector={d}
            size={size}
            className={cn('shadow-cutout-white', i > 0 && '-ml-1.5')}
          />
        ))}
        {rest > 0 && (
          <span
            className={cn(
              'grid flex-none place-items-center box-border border border-border bg-white font-semibold text-fg-1 shadow-cutout-white -ml-1.5',
              size === 24 ? 'size-6 rounded-xs text-nano' : 'size-8 rounded-sm text-micro',
            )}
          >
            +{rest}
          </span>
        )}
      </span>
    </span>
  );
}
