export { renderEmail, EMAIL_KEYS, BOARD, type EmailKey, type EmailProps } from './registry.js';
export {
  createMailer,
  recipientHash,
  type MailLog,
  type MailerConfig,
  type SendEmail,
  type SendOptions,
  type SendResult,
} from './send.js';
export type { RenderedEmail } from './layout.js';
export type { RenderContext } from './context.js';
export { maskAddress } from './templates/email-changed.js';
export { shortCompany } from './templates/weekly-summary.js';
export { leadSentence, type CaseHistoryItem } from './templates/case-resolved.js';
export type { SystematicIncident } from './templates/notify-systematic-error.js';
export { SAMPLES, SAMPLE_NOW } from './samples.js';
export { C as EMAIL_COLORS, DARK as EMAIL_DARK_COLORS } from './theme.js';
