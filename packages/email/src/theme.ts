/**
 * Colours and type from the E01–E22 boards (README decision 26). Light values are inline on every
 * element; the dark values are applied by class in clients that support
 * prefers-color-scheme (Apple Mail, iOS Mail, Outlook.com via [data-ogsc]/[data-ogsb]).
 */
export const C = {
  bg: '#E9E7E1',
  card: '#FFFFFF',
  fg: '#1A1A18',
  muted: '#6B6B67',
  /** Footer text sits on the outer background; one step darker than muted keeps 4.5:1. */
  footer: '#5C5C58',
  soft: '#F7F5F1',
  rule: '#E4E1DB',
  lime: '#D0E84A',
  ok: '#2F7D4F',
  bad: '#B42318',
  info: { bg: '#E5EDF5', icon: '#2B5C8A' },
  warning: { bg: '#FBF0DC', icon: '#8A520D' },
  error: { bg: '#FBE7E4', icon: '#B42318' },
} as const;

export const DARK = {
  bg: '#121211',
  card: '#1C1C1A',
  fg: '#F2F0EB',
  muted: '#AEACA5',
  footer: '#AEACA5',
  soft: '#272724',
  rule: '#3A3935',
  ok: '#7CC79A',
  bad: '#F2877B',
  info: '#1C2833',
  warning: '#33281A',
  error: '#3A1F1C',
} as const;

export const FONT = "'Plus Jakarta Sans', Arial, Helvetica, sans-serif";
export const MONO = "'JetBrains Mono', Consolas, 'Courier New', monospace";

/** The dark-mode stylesheet. Classes are set next to the inline light colours. */
export function darkCss(): string {
  const rules: [string, string][] = [
    ['.em-bg', `background-color: ${DARK.bg} !important`],
    ['.em-card', `background-color: ${DARK.card} !important`],
    ['.em-fg', `color: ${DARK.fg} !important`],
    ['.em-fg a', `color: ${DARK.fg} !important`],
    ['.em-muted', `color: ${DARK.muted} !important`],
    ['.em-muted a', `color: ${DARK.muted} !important`],
    ['.em-footer', `color: ${DARK.footer} !important`],
    ['.em-footer a', `color: ${DARK.footer} !important`],
    ['.em-soft', `background-color: ${DARK.soft} !important`],
    ['.em-rule', `background-color: ${DARK.rule} !important`],
    ['.em-line', `border-color: ${DARK.rule} !important`],
    ['.em-ok', `color: ${DARK.ok} !important`],
    ['.em-bad', `color: ${DARK.bad} !important`],
    ['.em-info', `background-color: ${DARK.info} !important`],
    ['.em-warning', `background-color: ${DARK.warning} !important`],
    ['.em-error', `background-color: ${DARK.error} !important`],
    ['.em-logo-light', 'display: none !important'],
    [
      '.em-logo-dark',
      'display: block !important; max-height: none !important; overflow: visible !important',
    ],
  ];
  const body = rules.map(([s, d]) => `${s} { ${d}; }`).join('\n    ');
  // Outlook.com rewrites colours and marks the body with data-ogsc (text) / data-ogsb (backgrounds).
  const ogs = rules
    .filter(([s]) => !s.startsWith('.em-logo'))
    .map(([s, d]) => `[data-ogs${d.startsWith('color') ? 'c' : 'b'}] ${s} { ${d}; }`)
    .join('\n  ');
  return `@media (prefers-color-scheme: dark) {\n    ${body}\n  }\n  ${ogs}`;
}
