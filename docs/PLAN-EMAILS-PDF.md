# PLAN-EMAILS-PDF: designede e-mails, notifikationsmails og PDF-dokumenter

Status: **skrevet 21. okt. 2026.** Charlie bad om at arbejdet gøres færdigt natten over uden godkendelsesrunde ("Finalize before you stop"). Der er derfor ikke ventet på en godkendelse. Hver beslutning, der normalt ville kræve et svar, står i §10 med det valg, jeg har truffet. Base: branch `v1.0`. Intet pushes til `main`.

Kilder: `docs/CLAUDE-CODE-EMAILS-INVOICES-PROMPT.md`, `docs/design/runde-1/README.md` beslutning 18 og 26 samt tabellen "E-mails", de 24 tegneflader `E01`–`E22`, `I01` og `I02`, artefaktet "Agentor e-mails" og koden pr. commit `8fe42a7`.

Regel ved konflikt: tegnefladen bestemmer layout og tekst. Listen og spec bestemmer triggere og regler. Er de uenige om en regel, står konflikten i §10.

---

## 1. Tegneflader: alle 24 er fundet

`E01`–`E22`, `I01-Faktura` og `I02-Kreditnota` ligger i `docs/design/runde-1/boards/`. Ingen mangler. Hver har en "Til udvikling"-strimmel med emne, forhåndstekst, trigger og felter. Teksten fra strimlerne og mailene er brugt ordret i skabelonerne.

## 2. Hvad der sendes i dag

Alle 18 mails er ren tekst via `sendMail()` i `apps/web/src/server/mail.ts` (nodemailer, Mailpit lokalt, Brevo SMTP i produktion). Worker og scheduler sender ingen e-mail.

| Board | Nøgle | Afsendes i dag fra (fil · funktion) | Bemærkning |
|---|---|---|---|
| E01 | `verify-email` | `server/auth/auth.ts` · `emailVerification.sendVerificationEmail` | Better Auth-link, 24 t |
| E02 | `reset-password` | `server/auth/auth.ts` · `emailAndPassword.sendResetPassword` | 1 t (`resetPasswordTokenExpiresIn: 3600`) |
| E03 | `new-device-login` | `server/auth/new-device.ts` · `notifyNewDevice` | Mangler sted i dag |
| E04 | `email-change-code` | `server/auth/security-events.ts` · `sendEmailChangeCode` (kaldt fra `auth.ts` `emailOTP.sendVerificationOTP`, type `change-email`) | |
| E05 | `email-changed` | `server/auth/security-events.ts` · `notifyOldAddress` | Mangler maskeret ny adresse, tid og enhed |
| E06 | `signup-code` | `server/signup-mail.ts` · `sendSignupCode` (kaldt fra `auth.ts` `sendVerificationOTP`, type `email-verification`) | |
| E07 | `signup-existing-account` | `server/signup-mail.ts` · `sendAlreadyHaveAccount` (kaldt fra `app/(signup)/actions.ts`) | |
| E08 | `subscription-receipt` | `server/signup-mail.ts` · `sendSignupReceipt` (kaldt fra `server/signup-receipt.ts`) | |
| E09 | `team-invite` | `app/(app)/settings/team/actions.ts` · `inviteMember` | |
| E10 | `customer-created` | `app/platform/customers/actions.ts` · `createCustomerAction` | |
| E11 | `owner-reinvite` | `app/platform/customers/[id]/admin-actions.ts` · `resendOwnerInvitationAction` | |
| E12 | `case-resolved` | `app/platform/actions.ts` · `resolveCaseAction` + `caseEmail` | Ingen Reply-To og ingen genåbning ved svar i dag |
| E13 | `desk-link` | `app/actions/desk-link.ts` · `sendDeskLink` | |
| E14 | `plan-price-change` | `app/platform/admin/product/actions.ts` · `sendPriceNotices` | |
| E15 | `invoice-reminder` | `app/platform/finance/actions.ts` · `notifyInvoiceAction` (kind `reminder`) | |
| E16 | `update-card` | `app/platform/finance/actions.ts` · `notifyInvoiceAction` (kind `link`) | Linker i dag til `/billing`, ikke QuickPays side |
| E17 | `account-statement` | `app/platform/finance/actions.ts` · `sendStatementAction` | |
| E18 | `monthly-report` | `app/platform/finance/actions.ts` · `sendReportAction` | CSV vedhæftet |

**E19–E22 har ingen e-mail-trigger.** Status for den underliggende hændelse:

| Board | Hændelse i dag | Mangler |
|---|---|---|
| E19 `notify-connection-broken` | `apps/worker/src/connections.ts` kalder `notify({event:'connection_broken'})` → række i `notifications` → push via `app.push_queue` | E-mail-kanal, kø-tal og påvirket flow |
| E20 `notify-systematic-error` | Kun `record_failed` pr. kørsel (`apps/worker/src/flows.ts` `processFinishJob`). Ingen detektion af "≥ 3 fejl på samme rute inden for 15 min." | Detektion, hændelse og mail |
| E21 `notify-quota-80` | `usage_counters` tælles, men intet skriver en `quota`-notifikation | Detektion ved 80 %, én gang pr. måned |
| E22 `weekly-summary` | Intet. Indstillingen `weekly_summary` findes (standard fra) | Ugentligt job, opsummering, afmelding |

Notifikationsindstillingerne (`notification_prefs` med kanalerne `in_app`, `email`, `push`, `sms` pr. hændelse, `notification_settings` med stilletid) findes og gemmes allerede fra D12/MA11/MA35.

## 3. Valg af teknik

### 3.1 E-mailskabeloner: ren TypeScript med en escapende `html`-tag (ingen ny afhængighed)

Ny workspace-pakke `packages/email` (`@agentor/email`). Hver skabelon er en funktion med typede props, der returnerer `{ subject, preheader, html, text }`. HTML bygges med en lille tagged template `html\`…\``, der escaper alle værdier, og blokkene er funktioner, der returnerer tabel-HTML med inline-styles.

Hvorfor ikke React Email eller MJML:

- **Worker og scheduler skal også sende** (E19–E22). De har ingen React/JSX-opsætning. En ren TS-pakke virker ens i web, worker og scheduler.
- **Pixel for pixel efter tegnefladen.** Tegnefladerne er allerede skrevet som 600 px tabeller med inline-styles. Den markup kan flyttes direkte over i blokke. React Email og MJML genererer deres egen markup, som så skal tvinges tilbage til tegnefladen.
- **Ingen ny afhængighed** (React Email er 10+ pakker; MJML trækker en stor kompiler med). `nodemailer` findes allerede.
- **Snapshots er stabile**: output er en deterministisk streng.

Tekstversionen bygges af de samme blokke (hver blok har en `text()`-side), så rækkefølgen altid følger HTML-versionen.

Tekster ligger i `packages/i18n/messages/{da,en}.json` under `email.<nøgle>` og formatteres med `formatMessage` fra `@agentor/core` (samme ICU-delmængde som push). Danske tekster er tegnefladens ordret.

### 3.2 PDF: den eksisterende håndskrevne PDF-motor udvides (ingen ny afhængighed)

`apps/web/src/server/invoice-pdf.ts` skriver i dag PDF 1.4 i hånden. Den flyttes til `packages/pdf` (`@agentor/pdf`) og udvides med fyldte rektangler med runde hjørner (lime/navy mærke, statusboks), farver, Courier til mono, vektorlogo (SVG-stierne fra `docs/design/runde-1/logos/agentor-logotype.svg`), sideskift med gentaget tabelhoved og "Side x af y".

Hvorfor ikke Playwright/Chromium: Playwright er i dag kun en dev-afhængighed til e2e. At bruge den til fakturaer betyder en runtime-afhængighed og en Chromium-binær på Plesk-serveren (ca. 300 MB, systembiblioteker, sandbox). Det er en driftsbeslutning, jeg ikke kan tage alene. Den håndskrevne motor giver præcis kontrol over tal og placering og kan testes uden browser.

**Afvigelse:** PDF/A-2b og indlejrede skrifttyper (Plus Jakarta Sans / JetBrains Mono) kræver skrifttypefiler (TTF) i repoet og en ICC-profil. Repoet har kun Next' woff2-delmængder. Fakturaen bruger derfor Helvetica og Courier (PDF-standardskrifter, ikke indlejret). Se Q3.

### 3.3 Afsendelse

`@agentor/email` eksporterer `sendEmail(key, props, options)`:

- vælger skabelonen ud fra nøglen (typet: `sendEmail('team-invite', props)` fejler i `tsc`, hvis props ikke passer),
- sætter `from` (`MAIL_FROM`), `to`, `replyTo`, `html`, `text`, `attachments` og `headers` (`X-Entity-Ref-ID` pr. hændelse, `List-Unsubscribe` + `List-Unsubscribe-Post` for E22),
- prøver igen op til 3 gange med backoff (0,5 s, 2 s, 8 s) ved forbindelsesfejl og 4xx/5xx-svar fra SMTP, der kan prøves igen,
- logger `{ template, to: sha256(to)[0..12], messageId, attempt }`. Aldrig emne, krop, kode eller link.

`apps/web/src/server/mail.ts` beholder transporten (Mailpit lokalt, fejl hvis `SMTP_URL` mangler i produktion) og giver den til `@agentor/email`. Worker og scheduler laver deres egen transport på samme måde.

## 4. Skabeloner, filer og kaldesteder

Alle skabeloner i `packages/email/src/templates/<nøgle>.ts`. Blokke i `packages/email/src/blocks.ts`, layout i `packages/email/src/layout.ts`.

| Board | Fil | Kaldested efter M2 | Udløb / regel |
|---|---|---|---|
| E01 | `verify-email.ts` | `auth.ts` `sendVerificationEmail` | 24 t |
| E02 | `reset-password.ts` | `auth.ts` `sendResetPassword` | 1 t; nuværende adgangskode virker stadig |
| E03 | `new-device-login.ts` | `new-device.ts` `notifyNewDevice` | ingen knap; enhed, cirka-sted (fra `cf-ipcountry`/IP-land er ikke tilgængelig → "ukendt sted", se Q6), tid |
| E04 | `email-change-code.ts` | `auth.ts` `sendVerificationOTP` (`change-email`) | 6 cifre, 10 min., kode først i emnet |
| E05 | `email-changed.ts` | `security-events.ts` `notifyOldAddress` | ingen knap; ny adresse maskeret `me•••@…` |
| E06 | `signup-code.ts` | `auth.ts` `sendVerificationOTP` (`email-verification`) | 6 cifre, 10 min. |
| E07 | `signup-existing-account.ts` | `app/(signup)/actions.ts` | sendes i stedet for E06; samme svar på siden |
| E08 | `subscription-receipt.ts` | `signup-receipt.ts` | momstabel; link til fakturaen, ingen PDF vedhæftet |
| E09 | `team-invite.ts` | `settings/team/actions.ts` `inviteMember` | 7 dage; adgang og udløb kun hvis sat |
| E10 | `customer-created.ts` | `platform/customers/actions.ts` | 14 dage; plan og første betaling inkl. moms |
| E11 | `owner-reinvite.ts` | `platform/customers/[id]/admin-actions.ts` | 14 dage; tidligere links ugyldige |
| E12 | `case-resolved.ts` | `platform/actions.ts` `resolveCaseAction` | forløb/tid/tilfredshed til/fra; aldrig interne noter; Reply-To = sagens adresse |
| E13 | `desk-link.ts` | `app/actions/desk-link.ts` | linket kræver login |
| E14 | `plan-price-change.ts` | `platform/admin/product/actions.ts` | gammel og ny pris inkl. moms, dato |
| E15 | `invoice-reminder.ts` | `platform/finance/actions.ts` (reminder) | "2. påmindelse" i emnet ved rykker 2 |
| E16 | `update-card.ts` | `platform/finance/actions.ts` (link) | QuickPays hostede side; ingen kortdata |
| E17 | `account-statement.ts` | `platform/finance/actions.ts` `sendStatementAction` | én linje pr. åben faktura eller "Ingen åbne poster" |
| E18 | `monthly-report.ts` | `platform/finance/actions.ts` `sendReportAction` | CSV `agentor-finans-ÅÅÅÅ-MM.csv` |
| E19 | `notify-connection-broken.ts` | worker `email-notify.ts` (kø) | kritisk, ignorerer stilletid |
| E20 | `notify-systematic-error.ts` | worker `email-notify.ts` (kø) | samles i stilletid |
| E21 | `notify-quota-80.ts` | worker `email-notify.ts` (kø) | højst én gang pr. måned pr. tenant |
| E22 | `weekly-summary.ts` | scheduler `weekly.ts` | mandag 08:00 Europe/Copenhagen; kun tilmeldte; afmeldingslink + header |

Blokke (alle 600 px, tabeller, inline-styles): `Heading` (30/700, −0.02em), `Paragraph`, `Button` (lime `#D0E84A`, pille, tabelcelle med `bgcolor`), `FallbackLink` (mono, `word-break: break-all`), `ExpiryChip` (urikon på `#F3F1EC`), `CodeBoxes` (6 felter, mono 30 px), `KeyValueTable` (valgfri fed totalrække), `Notice` (info/advarsel/fejl med skjold), `Panel`, `Divider`, `SmallPrint`, `SignOff`, `StatGrid`, `ProgressBar`, `Timeline`, `AttachmentChip`, `Ledger`. Ikoner er små PNG'er på `APP_URL/email/*.png` (ingen SVG i mail).

Logo: `apps/web/public/email/agentor-logo@2x.png` (224 × 54, renderet med `sharp` fra `agentor-logotype.svg`), vist som `width="112" height="27" alt="Agentor"`.

Mørk tilstand: `<meta name="color-scheme" content="light dark">` + `supported-color-schemes` og en `@media (prefers-color-scheme: dark)`-blok med klasser (Apple Mail, Outlook.com, iOS Mail følger den). Gmail ignorerer `<style>` med media queries og inverterer selv; derfor er alle farvepar valgt, så de holder 4,5:1 både i lys og inverteret form (tjekkes i test, se §8).

Forhåndsvisning: `apps/web/src/app/dev/emails/` (kun når `NODE_ENV !== 'production'`, ellers 404) med en liste over alle skabeloner og pr. skabelon HTML i lys og mørk ramme samt tekstversionen. Eksempeldata er tegnefladens fiktive data (`packages/email/src/samples.ts`).

## 5. Notifikationsmails E19–E22

**Kø:** ny tabel `app.email_queue` (samme mønster som `app.push_queue`): `id`, `tenant_id`, `notification_id`, `user_id`, `not_before`, `created_at`, `UNIQUE (notification_id)`. En trigger på `notifications` lægger rækken i køen, når notifikationens hændelse er `connection_broken`, `systematic_error` eller `quota`. Workeren dræner køen hvert 5. sekund under en Redis-lås (som push).

**Idempotens:** én række pr. notifikation (`UNIQUE`), og `notify()` dropper allerede gentagelser af en uløst notifikation for samme flow/forbindelse. `X-Entity-Ref-ID = <notification_id>`. E21 dedupliceres pr. tenant og måned (`usage_counters.quota_notified_at`). E22 pr. bruger og uge (`app.weekly_summary_sent (tenant_id, user_id, week)`).

**Modtagere:** medlemmer med `email = true` for hændelsen i `notification_prefs` (standard: `connection_broken` og `systematic_error` til, `quota` til, `weekly_summary` fra; se `DEFAULT_PREFS`). Workeren tjekker præferencen ved afsendelse, så en ændring efter hændelsen respekteres.

**Stilletid:** E19 ignorerer stilletid (kritisk). E20 og E21 udskydes til stilletidens slut (`quietUntil`), og flere E20 til samme bruger i stilletiden samles i én mail om morgenen (listen af flows i én `Notice` pr. fejl). E22 sendes kl. 08:00 og er aldrig i stilletid (standard 22–07); ligger brugerens stilletid over 08:00, udskydes den.

**Detektion:**
- E19: findes (`connection.test` fejler → `notify`). Ny: parametrene udvides med påvirkede flows/ruter og antal records i kø (`app.connection_impact`).
- E20: i `processFinishJob`: tæl fejlede records pr. rute og fejlkode de sidste 15 min.; når antallet når tenantens `alert_consecutive_failures` (standard 3), `notify({event:'systematic_error', messageKey:'systematicError', params:{count, flow, code, …}})`. Hvorfor/løsning er de samme tekster som i appen (`recordErrors.*`).
- E21: når workeren tæller en Live-skrivning og forbruget krydser 80 % af planens grænse (inkl. tilkøb), og `quota_notified_at` er tom for perioden → `notify({event:'quota'})`.
- E22: scheduler-job `weekly-summary` (gentagelse `0 8 * * 1`, `Europe/Copenhagen`, leder-lås) samler sidste uges kørsler pr. tenant og sender til tilmeldte medlemmer. Højst 5 flows, problemer først.

**Afmelding (E22):** signeret token (HMAC-SHA256 med `BETTER_AUTH_SECRET`, `userId`, `tenantId`, `event`) → `GET /unsubscribe?t=…` viser en bekræftelsesside, `POST` (fra knappen eller `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) slår `weekly_summary.email` fra og skriver audit-log.

**Log:** hver afsendelse skrives i tenantens audit-log som `email.sent` med skabelon og modtagerens bruger-id (ingen adresse).

## 6. Fakturaer (I01)

**Firmaoplysninger:** nye nøgler i `platform.settings` (Superadmin, Administration › Produkt › "Firmaoplysninger"): `companyName`, `companyAddress`, `companyPostalCity`, `companyCvr`, `companyEmail`, `bankReg`, `bankAccount`, `bankIban`. Tomme felter vises som `[CVR]` osv. på PDF'en, som på tegnefladen. Ændringer audit-logges (`settings.updated`). *Som bygget:* ingen `bankSwift` (IBAN rækker til danske kunder) og endnu ingen advarsel i Finans, mens felterne er tomme.

**Kundenummer:** `K-` + tenantens løbenummer. Ny kolonne `tenants.customer_number` (sekvens, udfyldt for eksisterende tenants i oprettelsesrækkefølge).

**Varianter fra én skabelon** (`packages/pdf/src/invoice.ts`): abonnement (én linje: plan, interval, periode), support (én linje pr. sag med registreret og oprundet tid, timepris 640,00 ekskl. moms; tidsloggen som bilag på efterfølgende sider når `attach_timelog`), EAN (statusboksen viser forfald, EAN-nr. og bankoplysninger). Lange lister deler sig over sider med gentaget tabelhoved.

**Lagring (som bygget):** PDF'en renderes første gang den hentes i en given tilstand og gemmes i `@agentor/storage` under `documents/<tenant>/<kind>/<ref>/<sha256>.pdf`. Tilstanden er fakturaens status (`open`/`paid`/…) eller kreditnotaens `refund-<metode>-<tilstand>`; hver tilstand gemmes én gang og overskrives aldrig, så en betalt faktura får et nyt, separat dokument i stedet for at ændre det udstedte. Privat tabel `app.documents` (`tenant_id`, `kind`, `ref_id`, `variant`, `storage_key`, `sha256`, `bytes`), kun tilgængelig gennem `app.document_find/document_save/document_by_id`. Ved udlevering tjekkes filens sha256 mod tabellen. Renderingen er deterministisk (samme input → samme bytes). Se Q5.

**Download (som bygget):** ruterne `/billing/invoices/[id]/pdf`, `/billing/credit-notes/[id]/pdf` (kun ejeren af virksomheden) og `/platform/finance/{invoices,credit-notes}/[tenant]/[id]/pdf` (Superadmin) tjekker adgang, sikrer det gemte dokument og svarer `303` til `/api/documents/<id>?exp=…&sig=…`: HMAC-SHA256 (nøgle afledt af `BETTER_AUTH_SECRET`) over dokument-id og udløb, gyldigt i 5 minutter, `no-store`. E-mails linker til siden bag login, aldrig til selve filen; se Q7.

**Nummer:** uændret `app.next_invoice_number()` (`INV/ÅÅÅÅ/nnnnn`, mindst 5 cifre, aldrig afkortet, 0043). Tegnefladens "2026-1061" er eksempeldata.

## 7. Kreditnotaer (I02)

**Model** (migration `0057_credit_notes_documents.sql`; 0054–0056 er e-mailkøen, ugentlig tilmelding og modtageropslag):

```
credit_notes (tenant_id, id, number text unique not null, invoice_id, invoice_number, invoice_date,
              reason text not null, refund_method 'card'|'offset', refund_state 'none'|'pending'|'done'|'failed',
              refund_payment_id, net_ore <= 0, vat_ore <= 0, created_by_name, created_at)
credit_note_lines (tenant_id, id, credit_note_id, line_index, text, quantity_milli < 0, unit_ore, amount_ore < 0)
app.credit_note_counters (year int primary key, last int)
```

- Nummer `K-ÅÅÅÅ-nnnn` fra `app.next_credit_note_number()` med en rækkelås på årets tæller (`UPDATE … RETURNING` i samme transaktion som indsættelsen). En rullet-tilbage transaktion giver nummeret tilbage, så serien er uden huller, også ved samtidighed. Mindst 4 cifre, aldrig afkortet. Erstatter den ubrugte `CRED/`-funktion fra 0043 (se Q2).
- Oprettes kun gennem `app.create_credit_note(invoice_id, lines jsonb, reason, refund_method)` (SECURITY DEFINER, kun Superadmin): låser fakturaen (`FOR UPDATE`), beregner det endnu ikke krediterede pr. linje og i alt, afviser hvis summen overstiger det, skriver kreditnota og linjer og audit-logger i både platformens og kundens log.
- Fakturaen ændres aldrig. "Efter kredit" og "krediteret" beregnes (`invoice_credit_totals` view).
- Tilbageførsel til kort: `QuickPayClient.refund(paymentId, amountOre)` (`POST /payments/{id}/refund?synchronized`, `QuickPay-Callback-Url`). Idempotent via `refund_state` (kun fra `none`→`pending` én gang) og QuickPay-ordre-id. Markeres `done` kun når QuickPays callback (eller synkront svar) bekræfter `accepted`. Mock-klienten bekræfter med det samme.
- "Modregnes i næste faktura": `refund_method='offset'`; `prepareCharge` giver næste abonnementsfornyelse en negativ linje "Modregning kreditnota K-…" og sætter `offset_invoice_id`. *Som bygget:* en kreditnota modregnes kun hel, og kun mens fakturaen stadig er over 0; ellers venter den til næste fornyelse. Supportfakturaer modregnes ikke endnu.
- *Som bygget:* svarer QuickPay ikke ved tilbageførsel, står kreditnotaen som `pending` (ikke `failed`), så den ikke tilbageføres to gange; Finans har "Prøv tilbageførsel igen" for `failed`.

**UI:** F4 (kundens økonomi) og F6 (fakturering): "Kreditér" på en betalt/åben faktura åbner et ark (*som bygget:* dialogen også på mobil; bundark mangler) med Hel/Delvis, linjer og mængder ved delvis, årsag (påkrævet) og tilbageførselsmetode. Kun Superadmin.

**Kunden:** Abonnement › Fakturaer viser kreditnotaer under fakturaen med PDF-download.

**PDF:** samme skabelon som fakturaen med navy "KREDITNOTA"-mærke, "Krediteres til", "Årsag", negative beløb og en infoboks om tilbageførslen.

## 8. Test og acceptkriterier

Fælles for alle mails (vitest i `packages/email`):
- snapshot af HTML og tekst pr. skabelon med tegnefladens data,
- ingen uopløste `{…}`, alle `href` absolutte (`https://`), emne og forhåndstekst findes og matcher tegnefladens strimmel ordret, forhåndsteksten er første element i `<body>`,
- tekstversionen indeholder overskrift, linket skrevet ud, udløb, sikkerhedsnote og footer i den rækkefølge,
- E03 og E05 indeholder intet login-link (`/login`, `/verify`, `/reset`, `/invite`),
- E12 indeholder aldrig en intern note,
- kontrast: hver forgrund/baggrund-kombination i blokkene ≥ 4,5:1.

E2E (Playwright med Mailpit): signup sender E06 eller E07 med samme sidesvar; nulstil adgangskode; teaminvitation; sag løst → svar genåbner sagen; E19 sendes ved afbrudt forbindelse med e-mail slået til og ikke når den er slået fra; E22 kun til tilmeldte, og afmelding virker.

PDF (vitest): teksten i PDF'en indeholder nummer, totaler og moms; totaler = summen af linjerne i øre; en faktura med mange linjer har tabelhovedet på hver side; en kreditnota kan aldrig overstige det ukrediterede (også to samtidige); nummerserien har ingen huller under samtidighed (isolation-test mod Postgres); download kun for rette tenant eller Superadmin.

Skærmbilleder: hver mail i lys og mørk tilstand ved 600 px og hver PDF-side som PNG i `docs/screenshots/emails-pdf/`.

Pr. board gælder acceptkriteriet: emne, forhåndstekst, overskrift, brødtekst, knaptekst, udløb, sikkerhedsnote, hilsen og footerens årsagslinje er ordret som tegnefladen (med variable felter udskiftet), og felterne i strimlen er alle props.

## 9. Milepæle

- **M1** fundament: `@agentor/email`, layout, blokke, afsender, tekstversioner, `/dev/emails`, E01–E07 flyttet.
- **M2** E08–E18 og alle kaldesteder på `sendEmail(key, props)`; `sendMail` fjernes fra handlingsfilerne. E12 Reply-To og genåbning ved svar (indgående webhook, Q4).
- **M3** E19–E22: kø, detektion, stilletid, idempotens, ugentligt job, afmelding.
- **M4** I01 i tre varianter, `@agentor/pdf`, `documents`, lagring, download, firmaoplysninger.
- **M5** kreditnota: model, migration, Finans-ark, tilbageførsel, I02, kundens liste.

## 10. Åbne spørgsmål og de valg, jeg har truffet i mellemtiden

| # | Spørgsmål | Valg nu | Hvad der skal til for at ændre det |
|---|---|---|---|
| Q1 | Agentors CVR, adresse, bank og IBAN | Felter i platformindstillinger (Superadmin); pladsholdere som på tegnefladen, til de er udfyldt | Udfyld dem under Administration › Produkt |
| Q2 | Kreditnotanummer: 0043 forbereder `CRED/ÅÅÅÅ/nnnnn` (fortløbende på tværs af år), tegnefladen og briefen siger `K-ÅÅÅÅ-nnnn` | `K-ÅÅÅÅ-nnnn`, ny tæller pr. år, uden huller. `CRED`-sekvensen er aldrig brugt, så intet nummer er udstedt i det gamle format | Ét ord, så skifter jeg formatet i funktionen |
| Q3 | PDF/A-2b og indlejrede skrifttyper | PDF 1.4 med Helvetica/Courier (ikke PDF/A) | TTF-filer for Plus Jakarta Sans og JetBrains Mono (OFL) i repoet, eller Playwright/Chromium som runtime-afhængighed på serveren |
| Q4 | Svar på E12 genåbner sagen: kræver indgående mail (Brevo Inbound Parsing + MX på fx `svar.agentor.dk`) | Reply-To `sag+<token>@<CASE_REPLY_DOMAIN>`; indgående webhook `POST /mail/inbound` på ingest med delt hemmelighed; genåbner inden for 14 dage. Uden `CASE_REPLY_DOMAIN` bruges `support@agentor.dk` og intet genåbnes automatisk | DNS og Brevo-opsætning |
| Q5 | Skal den gemte faktura-PDF vise "Betalt", når den betales efter udstedelse? | Ét uforanderligt dokument pr. tilstand: den udstedte (åbne) PDF bevares, og betalingen giver et nyt dokument med "Betalt" | Beslutning om "kvittering som separat dokument" i stedet |
| Q6 | E03 "Aarhus, Danmark (cirka)": appen har ingen IP-geolokation | Sted vises kun, hvis proxyen sender et land (`cf-ipcountry`/`x-country`); ellers udelades rækken | En GeoIP-database (ny afhængighed) |
| Q7 | "Signeret kortlivet URL" til PDF | Ruten med adgangstjek udsteder et HMAC-signeret link med 5 min. udløb til den gemte fil. Mails linker til siden bag login | Længere udløb eller link direkte i mailen |
| Q8 | E16 skal åbne QuickPays hostede side | Mailens knap peger på `/billing/payment` (kræver login), hvor ejeren starter QuickPays kortformular. Et QuickPay-link direkte i mailen ville udløbe og kunne videresendes | — |

## 11. Øvrige afvigelser og valg under byggeriet

- **Ugentligt overblik (E22):** `weekly_summary` står nu som standard til *fra* for e-mail; man tilmelder sig. Tilmeldinger samles i `weekly_optins` (trigger på indstillingerne), som schedulerens `weekly_summary_recipients()` læser på tværs af tenants (0055). E22 viser problemer først.
- **Modtagere:** workeren har ingen adgang til `auth`, så adresse og navn slås op gennem `app.email_recipient` (0056).
- **E01:** skabelonen findes, men bruges formentlig ikke: Better Auths `emailOTP` overtager e-mailbekræftelsen (E06/E07).
- **E17:** tegnefladens annotationslinje er udeladt (den er en note til designet, ikke tekst i mailen).
- **PDF-motor:** PDF 1.4, Helvetica/Courier med WinAnsi (− og → mappes), logo som vektor. Ikke PDF/A (Q3).
- **Kundenummer:** `tenants.customer_number` fra `app.customer_number_seq`, nummereret i oprettelsesrækkefølge for eksisterende kunder.
- **Ikke verificeret:** mørk tilstand i rigtige mailklienter (kun browserens `prefers-color-scheme`); Brevo Inbound og MX for `CASE_REPLY_DOMAIN`; QuickPays rigtige refund-endpoint (kun mock og enhedstest af klienten).
- **Kredit af rabatterede fakturaer:** negative linjer (rabat, modregning) trækkes fra de første positive linjer, før der krediteres, så der kun kan krediteres det, kunden faktisk betalte (`app.invoice_credit_state`).
- **Tilbageførsel uden status:** svarer QuickPay uden status på refund-operationen, står kreditnotaen som `pending` ligesom ved intet svar; kun et afvist svar giver `failed` (og "Prøv igen").
- **Sletning af en kunde** sletter også dens kreditnotaer (som fakturaerne, `ON DELETE CASCADE`). Det giver huller i K-serien, hvis en kunde med kreditnotaer slettes; afklares sammen med bogføringskravene for fakturaer.
