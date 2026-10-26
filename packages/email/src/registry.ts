import { tools, type RenderContext } from './context.js';
import { renderLayout, type RenderedEmail } from './layout.js';
import accountStatement, { type AccountStatementProps } from './templates/account-statement.js';
import caseResolved, { type CaseResolvedProps } from './templates/case-resolved.js';
import customerCreated, { type CustomerCreatedProps } from './templates/customer-created.js';
import type { Template } from './templates/define.js';
import deskLink, { type DeskLinkProps } from './templates/desk-link.js';
import emailChangeCode, { type EmailChangeCodeProps } from './templates/email-change-code.js';
import emailChanged, { type EmailChangedProps } from './templates/email-changed.js';
import invoiceReminder, { type InvoiceReminderProps } from './templates/invoice-reminder.js';
import monthlyReport, { type MonthlyReportProps } from './templates/monthly-report.js';
import newDeviceLogin, { type NewDeviceLoginProps } from './templates/new-device-login.js';
import notifyConnectionBroken, {
  type NotifyConnectionBrokenProps,
} from './templates/notify-connection-broken.js';
import notifyQuota80, { type NotifyQuota80Props } from './templates/notify-quota-80.js';
import notifySystematicError, {
  type NotifySystematicErrorProps,
} from './templates/notify-systematic-error.js';
import ownerReinvite, { type OwnerReinviteProps } from './templates/owner-reinvite.js';
import planPriceChange, { type PlanPriceChangeProps } from './templates/plan-price-change.js';
import resetPassword, { type ResetPasswordProps } from './templates/reset-password.js';
import signupCode, { type SignupCodeProps } from './templates/signup-code.js';
import signupExistingAccount, {
  type SignupExistingAccountProps,
} from './templates/signup-existing-account.js';
import subscriptionReceipt, {
  type SubscriptionReceiptProps,
} from './templates/subscription-receipt.js';
import teamInvite, { type TeamInviteProps } from './templates/team-invite.js';
import updateCard, { type UpdateCardProps } from './templates/update-card.js';
import verifyEmail, { type VerifyEmailProps } from './templates/verify-email.js';
import weeklySummary, { type WeeklySummaryProps } from './templates/weekly-summary.js';

/** Template key → props. The keys and board numbers are in docs/PLAN-EMAILS-PDF.md §4. */
export interface EmailProps {
  'verify-email': VerifyEmailProps;
  'reset-password': ResetPasswordProps;
  'new-device-login': NewDeviceLoginProps;
  'email-change-code': EmailChangeCodeProps;
  'email-changed': EmailChangedProps;
  'signup-code': SignupCodeProps;
  'signup-existing-account': SignupExistingAccountProps;
  'subscription-receipt': SubscriptionReceiptProps;
  'team-invite': TeamInviteProps;
  'customer-created': CustomerCreatedProps;
  'owner-reinvite': OwnerReinviteProps;
  'case-resolved': CaseResolvedProps;
  'desk-link': DeskLinkProps;
  'plan-price-change': PlanPriceChangeProps;
  'invoice-reminder': InvoiceReminderProps;
  'update-card': UpdateCardProps;
  'account-statement': AccountStatementProps;
  'monthly-report': MonthlyReportProps;
  'notify-connection-broken': NotifyConnectionBrokenProps;
  'notify-systematic-error': NotifySystematicErrorProps;
  'notify-quota-80': NotifyQuota80Props;
  'weekly-summary': WeeklySummaryProps;
}

export type EmailKey = keyof EmailProps;

const TEMPLATES: { [K in EmailKey]: Template<EmailProps[K]> } = {
  'verify-email': verifyEmail,
  'reset-password': resetPassword,
  'new-device-login': newDeviceLogin,
  'email-change-code': emailChangeCode,
  'email-changed': emailChanged,
  'signup-code': signupCode,
  'signup-existing-account': signupExistingAccount,
  'subscription-receipt': subscriptionReceipt,
  'team-invite': teamInvite,
  'customer-created': customerCreated,
  'owner-reinvite': ownerReinvite,
  'case-resolved': caseResolved,
  'desk-link': deskLink,
  'plan-price-change': planPriceChange,
  'invoice-reminder': invoiceReminder,
  'update-card': updateCard,
  'account-statement': accountStatement,
  'monthly-report': monthlyReport,
  'notify-connection-broken': notifyConnectionBroken,
  'notify-systematic-error': notifySystematicError,
  'notify-quota-80': notifyQuota80,
  'weekly-summary': weeklySummary,
};

/** Board number per key, for the preview and the screenshots. */
export const BOARD: Record<EmailKey, string> = {
  'verify-email': 'E01',
  'reset-password': 'E02',
  'new-device-login': 'E03',
  'email-change-code': 'E04',
  'email-changed': 'E05',
  'signup-code': 'E06',
  'signup-existing-account': 'E07',
  'subscription-receipt': 'E08',
  'team-invite': 'E09',
  'customer-created': 'E10',
  'owner-reinvite': 'E11',
  'case-resolved': 'E12',
  'desk-link': 'E13',
  'plan-price-change': 'E14',
  'invoice-reminder': 'E15',
  'update-card': 'E16',
  'account-statement': 'E17',
  'monthly-report': 'E18',
  'notify-connection-broken': 'E19',
  'notify-systematic-error': 'E20',
  'notify-quota-80': 'E21',
  'weekly-summary': 'E22',
};

export const EMAIL_KEYS = Object.keys(TEMPLATES) as EmailKey[];

/** Renders one template to subject, preheader, HTML and text. Pure; no I/O. */
export function renderEmail<K extends EmailKey>(
  key: K,
  props: EmailProps[K],
  ctx: Partial<RenderContext> & Pick<RenderContext, 'appUrl'>,
): RenderedEmail {
  const x = tools({ locale: 'da', now: new Date(), ...ctx });
  const template = TEMPLATES[key] as Template<EmailProps[K]>;
  return renderLayout(template.render(props, x), x);
}
