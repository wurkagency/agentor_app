import type { Block } from './blocks.js';
import type { Tools } from './context.js';
import { html, plain, raw, rich } from './html.js';
import { C, FONT, darkCss } from './theme.js';

/** What a template returns: the board's subject and preheader, its blocks and footer reason. */
export interface EmailContent {
  subject: string;
  preheader: string;
  blocks: Block[];
  /** "Du får denne mail, fordi …" (rich copy). */
  reason: string;
  /** A link after the reason: "Ret notifikationer", "Slå den fra". */
  footerLink?: { label: string; href: string };
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

/** Hidden filler after the preheader so clients don't pull body text into the inbox preview. */
const FILLER = '&#847;&zwnj;&nbsp;'.repeat(60);

/**
 * The one layout every Agentor e-mail uses (README decision 26): logo, the template's blocks in
 * a white 600 px card, and a footer with the company line and the reason for the mail.
 * The markup is hand-written for mail clients (tables, inline styles, Outlook conditionals);
 * Prettier leaves it alone (embeddedLanguageFormatting off for this package).
 */
export function renderLayout(content: EmailContent, x: Tools): RenderedEmail {
  const lang = x.ctx.locale;
  const footerLine = x.t('common.footer');
  const logo = (variant: 'dark' | 'light') => x.url(`/email/agentor-logo-${variant}@2x.png`);
  const footerLink = content.footerLink
    ? html` <a href="${content.footerLink.href}" target="_blank" class="em-footer" style="color: ${C.footer}">${content.footerLink.label}</a>`
    : '';
  const body = html`<!doctype html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${content.subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if !mso]><!--><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap"><!--<![endif]-->
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; }
  @media only screen and (max-width: 620px) {
    .em-wrap { width: 100% !important; }
  }
  ${raw(darkCss())}
</style>
</head>
<body class="em-bg" style="margin: 0; padding: 0; background: ${C.bg}; font-family: ${raw(FONT)}; color: ${C.fg}">
<div style="display: none; max-height: 0; max-width: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: transparent; opacity: 0">${content.preheader}${raw(FILLER)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-bg" bgcolor="${C.bg}" style="background: ${C.bg}">
<tr><td align="center" style="padding: 32px 0 48px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" class="em-wrap" style="width: 600px; max-width: 600px; margin: 0 auto; border-collapse: separate; font-family: ${raw(FONT)}">
  <tr><td class="em-card" bgcolor="${C.card}" style="background: ${C.card}; border-radius: 20px; overflow: hidden">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding: 32px 40px 0">
        <img class="em-logo-light" src="${logo('dark')}" alt="Agentor" width="112" height="27" style="display: block; height: 27px; width: 112px; border: 0">
        <!--[if !mso]><!--><img class="em-logo-dark" src="${logo('light')}" alt="Agentor" width="112" height="27" style="display: none; max-height: 0; overflow: hidden; height: 27px; width: 112px; border: 0"><!--<![endif]-->
      </td></tr>
      ${content.blocks.map((b) => b.html)}
    </table>
  </td></tr>
  <tr><td class="em-footer" style="padding: 24px 40px 0; text-align: center; font-size: 12px; line-height: 1.6; color: ${C.footer}">
    ${footerLine.replace('support@agentor.dk', '')}<a href="mailto:support@agentor.dk" class="em-footer" style="color: ${C.footer}">support@agentor.dk</a><br>${rich(content.reason, `color: ${C.footer}`)}${footerLink}
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    content.blocks
      .map((b) => b.text)
      .filter((t): t is string => t !== null && t !== '')
      .join('\n\n'),
    [
      '-- ',
      footerLine,
      plain(content.reason),
      ...(content.footerLink ? [`${content.footerLink.label}: ${content.footerLink.href}`] : []),
    ].join('\n'),
  ].join('\n\n');

  return {
    subject: content.subject,
    preheader: content.preheader,
    html: body.value,
    text: `${text}\n`,
  };
}
