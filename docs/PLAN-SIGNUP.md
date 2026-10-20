# PLAN-SIGNUP: selvbetjent signup og onboarding

Status: **godkendt 20. okt. 2026 (§11). S1 i gang.** Base: branch `v1.0`. Intet pushes til `main`.

Kilder: `docs/CLAUDE-CODE-SIGNUP-PROMPT.md`, `docs/design/runde-1/README.md` beslutning 11, 13, 18, 20, 21 og 22 samt "Kendte pladsholdere", de 22 tegneflader (`SU1`–`SU6`, `OB1`–`OB5`, `MS1`–`MS6`, `MO1`–`MO5`), produktspecifikation §3, §5.4–5.5, §6, §7.8–7.9, §9.5–9.6, §11, §14.3 og designspecifikation §3.1, §5.3–5.4, §9.

Regel ved konflikt: tegnefladerne bestemmer layout, tekster og tilstande. Spec og README-beslutningerne bestemmer data og regler. Under 768 px er MS/MO-tegnefladen reference, fra 768 px SU/OB. Er de uenige, spørger jeg (§11) og gætter ikke.

---

## 1. Hvad der findes i dag

| Område | Findes | Genbruges / ændres / fjernes |
| --- | --- | --- |
| Better Auth (`apps/web/src/server/auth/auth.ts`, v1.7.7) | E-mail + adgangskode (Argon2id, 12–128 tegn), `disableSignUp: true`, `requireEmailVerification`, verifikation med **link** (24 t), Redis-rate-limit, lockout, `twoFactor`, `passkey`. Ingen `socialProviders`, ingen e-mail-OTP. | **Ændres:** `emailOTP`-plugin (6 cifre, erstatter linket) og `socialProviders` google + microsoft. Begge er i `better-auth`, ingen ny afhængighed. |
| Signup (`(focus)/signup/*`) | Server action med IP-rate-limit, ingen e-mail-enumeration ("du har allerede en konto"-mail), opretter bruger uden tenant, betingelser accepteres ved signup. | **Genbruges:** enumeration-logikken. **Fjernes:** betingelses-afkrydsningen her (betingelser accepteres kun ved betaling). Siden erstattes af SU1/MS1. |
| Tenant (`schema/tenancy.ts`, `app.create_tenant` i 0010) | `status` = `active \| suspended \| deleting`, default `active`, læses ikke af koden. `create_tenant` laver tenant + ejer-medlemskab + `subscriptions(status='incomplete')` + audit. **Tenanten kan bruges før betaling.** | **Ændres:** ny eksplicit `signup_state` (§3). `create_tenant` sætter `pending_plan`. App-adgang kræver `active`. |
| Planer (`plans`, `plan_entitlements`, 0003/0011/0037) | Månedspris i øre (7900/15900/29900 ekskl. moms), entitlements som data, `recommended_for_orders`, `features`. Årspris = 10 × måned (`core/finance.ts`), moms 25 % (`withVat`). Superadmin redigerer via `app.platform_plan_update`. | **Genbruges** uændret til priser. **Ændres:** ordre-intervaller (§3.4) og ny nøgle `recommended_for_systems`. |
| QuickPay (`packages/billing/src/quickpay.ts`) | `POST /subscriptions`, `PUT /subscriptions/{id}/link` (QuickPays betalingsvindue), `POST …/recurring?synchronized`. Mock/test/live, mock afvises i produktion. HMAC-SHA256-verifikation (`quickpay-checksum-sha256`, `timingSafeEqual`). | **Genbruges.** Hosted betalingsvindue er allerede vejen (§4). |
| Callback (`apps/ingest` `/billing/quickpay` → worker `billing.ts`) | 401 ved forkert signatur, job-id `qp-<sha256(raw)>` (idempotent), `resolveBillingRef` slår tenant op fra vores egen tabel (callback-body stoles ikke på). | **Genbruges.** Udvides med aktivering af tenant (§4.3). |
| Billing-repo (`packages/db/src/repo/billing.ts`) | `applySubscriptionAuthorized` sætter abonnementet `active`, **første opkrævning sker først ved schedulerens næste tick.** `prepareCharge` idempotent pr. periode, `applyChargeResult` med `past_due` og genforsøg 2/5/9 dage, `changeInterval`. | **Ændres:** første opkrævning sker straks efter kortgodkendelse, og første betaling aktiverer tenanten. Genforsøg 2/5/9 gælder kun fornyelser. |
| CVR (`apps/web/src/server/cvr.ts`) | `CVR_PROVIDER=fixture \| datafordeler`. Datafordeler-GraphQL med 8 s timeout. FOLLOW-UP-note: feltnavne er ikke verificeret. Fixture: 12345678 Nordlys Cykler ApS. | **Genbruges**, Datafordeler (B2). |
| Audit (`repo/audit.ts`) | `writeAudit`, `writeSystemAudit`, append-only, `maskIp`, `redact`. | **Genbruges.** |
| Gamle onboarding (`(focus)/onboarding/*`) | 3 trin fra de fjernede D14-Onboarding-1..3: virksomhed, plan + kort, skabelon. | **Fjernes** i S4 (§8). |
| Connectors (`packages/connectors`) | 7 manifester med `available: true` (woocommerce, shopify, dinero, economic, hubspot, brevo, mailchimp) og 16 "På vej". Kun `MockAdapter`. OAuth findes kun som mock-samtykkeside (`/connect/[connector]`, 404 uden `CONNECTOR_MODE=mock`). Ingen rigtige OAuth start/callback-ruter. | **Genbruges** (`connectWithKey`, `completeMockOAuth`, `createConnection`). Se B4 og Q6. |
| Skabeloner (`components/editor/templates.ts`) | 7 skabeloner, `createFromTemplate` laver flow + kladdeversion, alle ruter i `test`. Gammel onboarding har sin egen liste med 6 (`options.ts`). | **Ændres:** én fælles skabelonliste med anbefalingsdata (§3.5). Den gamle liste fjernes. |
| Testkørsel | `requestRun(…,'test')`, worker `TEST_LIMIT = 10`, engine tvinger `dry_run`, test "never writes in dry-run" findes. `markFirstTestRun`. | **Genbruges** uændret. |
| Publicér | `publishDraft` (`app.publish_flow_version`), kræver grøn validering, "Som kladde" (beslutning 11). | **Genbruges** til "Gå live som kladde". |
| UI | `packages/ui` (Button, Field/Input/Checkbox/RadioCard, Segmented, Card, Banner, Skeleton, EmptyState, LoadError, ConnectorLogo …) og `@agentor/ui/mobile` (`Responsive`, `MobileShell`, `BigButton`, `MobileCard`, `LogoChain`, `MobileError` …). Skift ved 768 px er ren CSS. | **Genbruges.** Nye komponenter i §6. |
| Mobil | PLAN-MOBILE §1 lister `/onboarding/*` og `/signup` som desktop-only (`DeskOnly`, område `signup`). | **Ændres** i samråd med mobilsessionen: beslutning 22 giver nu mobile tegneflader, så de to ruter får en mobilgren. Se §9. |

---

## 2. Ruter

Ny route group `apps/web/src/app/(signup)/` med eget layout (`SignupShell`). Ikke `(focus)`, fordi SU/OB er tospaltede (formular + navy tillidspanel), ikke et centreret kort. Hver side returnerer `<Responsive mobile={…} desktop={…} />` med én server-loader, som i mobilarbejdet.

| Rute | Desktop ≥ 768 | Mobil < 768 | Kræver |
| --- | --- | --- | --- |
| `/signup` | SU1 | MS1 | Ingen session, eller bruger uden tenant (så sendes man videre) |
| `/signup/verify` | SU2 | MS2 | Ventende e-mail-signup (signeret, kortlivet cookie med e-mail, ingen session) |
| `/signup/company` | SU3 | MS3 | Verificeret bruger uden tenant, eller tenant i `pending_plan`/`pending_payment` (redigér) |
| `/signup/plan` | SU4 | MS4 | Tenant i `pending_plan` eller `pending_payment` |
| `/signup/payment` | SU5 | MS5 | Tenant i `pending_payment` |
| `/signup/welcome` | SU6 | MS6 | Tenant `active` og `onboarding_step` ≠ `done` |
| `/onboarding/webshop` | OB1 | MO1 | `active`, ejer |
| `/onboarding/accounting` | OB2 | MO2 | `active`, ejer, webshop forbundet eller sprunget over i trinnet |
| `/onboarding/template` | OB3 | MO3 | `active`, ejer, begge forbundet |
| `/onboarding/test` | OB4 | MO4 | `active`, ejer, kladdeflow findes |
| `/onboarding/done` | OB5 | MO5 | `active`, ejer, flowet er publiceret |

**Vagten** er én ren funktion i `@agentor/core`: `signupStep(state) → Step`, hvor `state` er (session?, e-mail verificeret?, tenant?, `signup_state`, `onboarding_step`, abonnement/første faktura). Hver side kalder `requireSignupStep('plan')`:

- Er brugerens aktuelle trin **før** det ønskede, redirectes til det aktuelle trin.
- Tilbage til et tidligere trin i samme fase er tilladt (Tilbage-knapperne): `company` og `plan` kan åbnes fra `payment`. `/signup` og `/signup/verify` kan ikke åbnes, når e-mailen er verificeret.
- Aktiv tenant på `/signup/*` → `/` (undtagen `/signup/welcome` lige efter aktivering, se ovenfor).
- `(app)/layout.tsx` og `requireAppContext` sender en tenant, der ikke er `active`, til dens signup-trin. Det erstatter `onboardingCompleted`-redirecten til `/onboarding/plan`.
- Genoptagelse: login → `requireAppContext` → signup-trin. Man lander altid på `signupStep(state)`.
- Platform-medarbejdere uden egen tenant går som i dag til `/platform`.

Vagten testes som ren funktion (alle kombinationer) og i e2e (dybe links til senere trin).

---

## 3. Datamodel

Migration `0038_signup.sql` (drizzle-genereret) + `0039_signup_security.sql` (håndskrevet: funktioner, RLS, grants). Kun PG12-kompatibel SQL: ingen `gen_random_uuid()` uden pgcrypto (vi bruger appens uuidv7), ingen PG13+-funktioner.

### 3.1 Tilstandsmaskine

```
                 SSO (Google/Microsoft): e-mail er verificeret af udbyderen
                ┌──────────────────────────────────────────────┐
 (ingen) ─SU1─▶ unverified ─SU2 kode─▶ verified (bruger, ingen tenant) ─SU3─▶ pending_plan
                                                                               │ SU4 plan + periode
                                                                               ▼
                                                                         pending_payment ◀─ SU4 igen (skift plan)
                                                                               │ verificeret callback:
                                                                               │ første faktura betalt
                                                                               ▼
                                                                             active ─▶ onboarding_step …

 Ikke active 24 timer efter at kontoen blev oprettet → hård sletning (B1).
```

- `unverified` og `verified` er **brugertilstande** (Better Auth `user.emailVerified` og "har ingen tenant"). En tenant kræver navn, så den oprettes først i SU3.
- `tenants.signup_state` text, check `pending_plan | pending_payment | active`. Default `active` for eksisterende rækker; `app.create_tenant` sætter `pending_plan`. Den eksisterende `status` (`active | suspended | deleting`) er drift og forbliver adskilt.
- `tenants.signup_state_at timestamptz` (sidste overgang).
- Overgange sker kun i SECURITY DEFINER-funktioner med `UPDATE … WHERE signup_state = <forventet>`, så en gentagen hændelse ikke gør noget: `app.signup_choose_plan` og `app.signup_activate` (kun kaldt af worker ved betalt første faktura).
- Hver overgang skriver audit (`signup.plan_chosen`, `tenant.activated`).
- **Oprydning (B1):** scheduler-job hvert 15. minut, `app.signup_purge()` (SECURITY DEFINER, kun worker-rollen). Det sletter hårdt, når kontoen er over 24 timer gammel og ikke har nogen aktiv tenant: tenanten (`pending_*`) med abonnement, fakturaer, betingelsesaccepter og audit-rækker, og brugeren med sessioner, konti og koder. QuickPay-abonnementet annulleres først. Undtagelser: en betaling, der er i gang (link åbnet eller kort godkendt inden for den sidste time), venter til næste kørsel; en bruger, der er medlem af en anden tenant, beholdes, og kun den ubetalte tenant slettes. Sletningen logges uden persondata (antal) i driftsloggen. Brugeren kan derefter tilmelde sig igen med samme e-mail.

**Før aktivering kan brugeren ikke nå app-ruter, oprette forbindelser eller køre flows.** Det håndhæves tre steder:
1. Vagten (§2) i `(app)`-layoutet, `requireAppContext` og alle server actions under `(app)`.
2. DB: `app.tenant_is_active()` i `WITH CHECK` på RLS-politikkerne for INSERT på `connections`, `connection_secrets`, `flows` og `flow_versions`, så en omgået vagt stadig fejler.
3. Worker og scheduler springer kørsler over for tenants, der ikke er `active` (tjek i `requestRun`/`enqueueRun` og i jobbet).

### 3.2 Onboarding-tilstand

- `tenants.onboarding_step` text, check `webshop | accounting | template | test | done`, null før aktivering.
- `tenants.onboarding_skipped_at timestamptz`. Sat ved "Spring over". Overblik viser påmindelseskortet, så længe `onboarding_step ≠ done`.
- `tenants.onboarding_flow_id uuid` (FK til `flows`, samme tenant): kladden fra OB3.
- Eksisterende `onboarding_completed_at` sættes ved `done`. `first_test_run_at` genbruges.

### 3.3 Systemvalg

- `tenants.chosen_connectors text[]` (connector-id'er, valideret mod kataloget, maks. 30). Kategori (webshop, regnskab, CRM, marketing) læses fra kataloget, ikke gemt dobbelt.
- `tenants.orders_per_month` findes; værdierne ændres (§3.4).
- Bruges til: forvalg i OB1 (første valgte webshop) og OB2 (første valgte regnskab), "HubSpot kan vente"/"Tilføj HubSpot" (valgt CRM/marketing), anbefalet plan og anbefalet skabelon.

### 3.4 Planer og anbefaling (data)

- Ordre-intervallerne følger SU3: `lt100` ("Under 100"), `100-1000` ("100–1.000"), `gt1000` ("Over 1.000"). Migration omskriver `recommended_for_orders` og eksisterende `orders_per_month` (`0-200`→`lt100`, `200-1000`→`100-1000`, `1000+`→`gt1000`).
- Ny entitlement-nøgle `recommended_for_systems` `{ "max": 3 }` (null = ingen grænse) og tilføjes til allow-listen i `app.platform_plan_update`, så Superadmin kan rette den.
- `recommendPlan(plans, { orders, systemCount })` i `@agentor/core`: første plan i `sort_order`, hvis `recommended_for_orders` indeholder intervallet og `systemCount ≤ recommended_for_systems.max`. Ingen plan-id'er i koden. Teksten "Passer til 100–1.000 ordrer og 3 systemer" bygges af de samme data.
- Priser vises fra `plans.price_monthly_ore`; årligt = `YEARLY_MONTHS × måned` (10), "Svarer til X kr./md." = årspris / 12, afrundet til øre. "2 måneder gratis" er en tekst, der kun vises, når `YEARLY_MONTHS = 10`.
- `[ANTAL]` vises, når `transactions_per_month` mangler i `plan_entitlements`. I dag har Enterprise 2000 (Q14).

### 3.5 Skabeloner (data)

Én liste i `packages/flows` (flyttes fra `components/editor/templates.ts`), brugt af både editorens skabelonvælger og OB3:

```ts
{ id, source: ['woocommerce','shopify'], destinations: ['dinero'], routes: [...],
  recommend: { requires: { webshop: true, accounting: true }, priority: 10 } }
```

`recommendTemplate(templates, chosen)` vælger den med flest opfyldte krav blandt dem, hvis connectors alle er valgt og tilgængelige, og bryder lighed med `priority`. SU3's sidepanel ("WooCommerce, Dinero og HubSpot passer sammen") og OB3's "Anbefalet" bruger samme funktion.

### 3.6 Betingelser

- Global tabel `legal_documents(key, version, title, url, published_at)`, skrivebeskyttet for runtime. Seed: `subscription_terms` og `privacy_policy` med version og URL som pladsholder (Q9).
- `terms_acceptances(id, tenant_id, user_id, document_key, document_version, accepted_at, ip_masked)`, RLS, kun INSERT og SELECT (som `audit_log`).
- Skrives i samme transaktion som audit `terms.accepted` (begge dokumenter og versioner), lige før betalingsvinduet åbnes.

### 3.7 Verifikationskoder

Better Auth `emailOTP` (`otpLength: 6`, `expiresIn: 600`, `allowedAttempts: 5`, `storeOTP: 'hashed'`, `overrideDefaultEmailVerification: true`). Koder ligger i Better Auths `verification`-tabel; ingen ny tabel.

---

## 4. QuickPay

### 4.1 Forslag: QuickPays hostede betalingsvindue

Kortet indtastes i QuickPays betalingsvindue (`PUT /subscriptions/{id}/link`), som koden allerede bruger. Embedded fields er alternativet.

| | Hostet vindue (forslag) | Embedded fields |
| --- | --- | --- |
| PCI | **SAQ A.** Kortdata indtastes på QuickPays domæne. Vi modtager, behandler og sender aldrig kortnummer, udløb eller CVC. Vores ansvar: TLS, linket dannes på serveren, nøgler holdes hemmelige, callbacks verificeres. | Stadig SAQ A, fordi felterne er iframes fra QuickPay. Men vores side indlæser QuickPays script, så siden selv bliver en del af angrebsfladen: vi skal kunne vise, at siden ikke kan få injiceret scripts (scriptinventar, integritet, overvågning af ændringer). |
| CSP | Uændret (kun redirect). | `script-src` og `frame-src` til QuickPay. Det løsner den stramme nonce-CSP (spec §9.5). |
| 3-D Secure, mobil | Klares i QuickPays vindue. | 3-D Secure i iframe på 390 px skal testes for sig. |
| Kode | Findes allerede: mock, test, live og callback. | Ny integration. Det skal først verificeres i QuickPays dokumentation, at embedded fields understøtter abonnementer. |
| Tegnefladen | Kortfelterne på SU5/MS5 kan ikke stå på vores side. | Matcher SU5/MS5 og review-noten om MS5 (udløb fylder rækken, smal CVC). |

**Anbefaling: hostet vindue.** Mindst PCI-omfang, ingen løsnet CSP, ingen ny integration. Prisen er, at kortblokken på SU5/MS5 ændres fra tre felter til et "Betalingskort"-kort, der siger, at kortet indtastes hos QuickPay i næste trin. Det er en layoutændring på tegnefladen, godkendt som B3. Vælger du embedded fields, bygger jeg dem som på tegnefladen og MS5-noten.

### 4.2 Flow (hostet vindue)

1. **SU5 renderes** fra DB: plan, periode, nettobeløb, moms 25 % og "I alt i dag", alt i øre (integers), formateret `1.987,50 kr.` Fornyelsesdato = i dag + periode.
2. **"Betal … og start"** er disabled, indtil begge afkrydsninger er sat. Server action `startSignupPayment({ acceptTerms: true, acceptPrivacy: true, versions })`:
   - validerer igen på serveren (begge `true`, versionerne er de aktuelle), at tenanten er `pending_payment`, og at brugeren er ejer;
   - skriver `terms_acceptances` × 2 + audit i én transaktion;
   - opretter QuickPay-abonnementet, hvis det mangler (`startCardSetup`), og et link med beløb = første periode inkl. moms, `continueurl=/signup/payment?return=1`, `cancelurl=/signup/payment?cancelled=1`, `callbackurl` = ingest;
   - returnerer URL'en; browseren går til QuickPay. Rate-limit 10 pr. time pr. tenant.
3. **QuickPay → callback "Subscription" accepteret** (kort godkendt) → ingest verificerer HMAC → job → worker: `applySubscriptionAuthorized` gemmer kortets brand og sidste 4 cifre (det QuickPay sender, aldrig mere). Er tenanten `pending_payment`, oprettes første faktura med det samme (`prepareCharge`) og der startes en `recurring` med `auto_capture`.
4. **QuickPay → callback "Payment" accepteret og captured** → worker: `applyChargeResult` markerer fakturaen betalt. I samme transaktion: er det tenantens første faktura og tenanten `pending_payment`, kaldes `app.signup_activate` → `active`, `onboarding_step = 'webshop'`, audit `tenant.activated`, kvitteringsmail i kø (én gang, fordi overgangen er betinget).
5. **Browseren** kommer tilbage til `/signup/payment?return=1` og viser "Vi venter på bekræftelse fra QuickPay" med en tilgængelig statusbesked (`aria-live`). Siden spørger hvert 2. sekund i op til 2 minutter. Når tenanten er `active`, går den til `/signup/welcome`. Derefter siger den: "Det tager længere end normalt. Du får en mail, så snart betalingen er bekræftet." **Redirecten aktiverer aldrig noget.**

### 4.3 Fejl, idempotens og fornyelser

- **Afvist kort eller fejlet første betaling:** tenanten bliver i `pending_payment`, abonnementet i `incomplete`, og fakturaen markeres fejlet uden automatiske genforsøg. `/signup/payment` viser fejlen ved knappen ("Betalingen blev afvist. Prøv igen, eller brug et andet kort.") og "Prøv igen" (nyt link, samme abonnement). `cancelled=1` viser en neutral besked.
- **Fornyelser** følger beslutning 18 uændret: `past_due` og genforsøg efter 2, 5 og 9 dage. `applyChargeResult` får en gren, så genforsøgslogikken kun kører, når tenanten er `active`.
- **Signatur:** ingest afviser manglende eller forkert `quickpay-checksum-sha256` med 401 før parsing. Testmode-callbacks afvises i live.
- **Idempotens:** samme råbody → samme job-id (findes). Derudover er hver tilstandsovergang betinget (`WHERE signup_state = 'pending_payment'`, faktura `WHERE status <> 'paid'`). Samme callback to gange giver én aktivering, én audit-række og én kvitteringsmail. To forskellige callbacks for samme betaling (QuickPay sender flere) giver samme resultat.
- **Ude af rækkefølge:** kommer "Payment" før "Subscription", er det `resolveBillingRef` + fakturaens tilstand der afgør det, ikke rækkefølgen.
- **Kortdata:** vi gemmer kun brand, sidste 4 cifre og udløbsmåned, som QuickPay sender. Logs maskerer callback-bodies (ingen `metadata` med kortdata logges). Test (§7) scanner logs og DB-dump efter testkortnumre.
- **Fornyelsesbesked** "Du får besked 14 dage før" findes ikke i dag. Se Q13.

### 4.4 Test-mode

CI kører med `QUICKPAY_MODE=mock`: mock-checkout signerer en callback med samme HMAC og sender den gennem den rigtige ingest-verifikation og worker. Den rigtige test-mode (QuickPays testkonto, testkort) kræver en offentligt nåbar callback-URL. Den kører jeg som en markeret e2e-suite (`@quickpay-test`), der springes over med en tydelig besked, når nøglerne ikke er sat. Den rapporteres aldrig som bestået, hvis den ikke har kørt (Q19).

---

## 5. Konto og identitet

- **E-mail-signup (SU1):** server action (den eksisterende, udvidet). Samme svar og samme svartid, uanset om e-mailen findes: mailen sendes fra en kø. Ny e-mail → bruger med `emailVerified: false` + `credential`-konto, OTP sendes. Eksisterende e-mail → "Du har allerede en konto"-mail, ingen kode. I begge tilfælde sættes den signerede `signup_pending`-cookie (e-mail, 15 min, HttpOnly) og brugeren går til `/signup/verify`.
- **Kode (SU2):** `CodeInput` (6 felter, indsæt, auto-videre). Verificering via `emailOTP.verifyEmail` → session (`autoSignInAfterVerification`) → `/signup/company`. Forkert eller udløbet kode giver samme fejl ("Koden er forkert eller udløbet").
- **Rate limits:** send kode 1 pr. 60 s pr. e-mail (nedtællingen på SU2 kommer fra serveren), 5 pr. time pr. e-mail, 20 pr. time pr. IP. Verificér 5 forsøg pr. kode (Better Auth), derefter ny kode krævet, og 10 pr. 15 min pr. IP. Alle i Redis (`redisRateLimitStorage`).
- **SSO (SU1 knapper):** Better Auth `socialProviders.google` og `socialProviders.microsoft` (`tenantId: 'common'`). `callbackURL` og `newUserCallbackURL` = `/signup/company`; vagten sender aktive brugere til `/`. SSO springer `/signup/verify` over. Eksisterende konto med samme e-mail: Better Auth account linking kun for `trustedProviders: ['google','microsoft']` med verificeret e-mail fra udbyderen. Nye env-variabler (kun navne): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`.
- **Mock-SSO til e2e:** `SSO_MODE=mock` registrerer i stedet `genericOAuth` med provider-id `google`/`microsoft` mod en lokal mock-IdP under `/dev/oauth/*` (kun med `AGENTOR_DEV_PAGES=1`, afvist i produktion som QuickPay-mock).
- **MFA for ejeren** (spec §6 og §9.5): se Q4.
- **Login for SSO-brugere** senere: D14-Login og MA01 har ingen SSO-knapper. Se Q5.

---

## 6. Komponenter

Nye komponenter i `packages/ui/src/components/signup/` (eksporteret som `@agentor/ui/signup`). Mobilvarianter bruger `@agentor/ui/mobile`, hvor det findes. Alle har tilstandene indhold, indlæsning, tom og fejl (designspec §5.4), og alle får en side på `/dev/components` og et komponent-e2e.

| Komponent | Indhold | Tilstande ud over indhold |
| --- | --- | --- |
| `SignupShell` | Logo øverst til venstre (også SU6/MS6), link øverst til højre ("Har du allerede en konto? Log ind" / "Spring over og gå til overblik"), formularkolonne, valgfrit `TrustPanel`. Mobil: 40 px over første overskrift (eller over elementet over den), `StepProgress` i bunden. | Indlæsning: skeleton af formularkolonnen. Fejl: `LoadError` i kolonnen. |
| `StepProgress` | `variant="top"`: "Trin 2 af 4", "Næste: …", fire lige brede bjælker, inde i formularkolonnen over overskriften. `variant="bottom"`: 3 px bjælker og lille grå tekst under hovedknappen ("Trin 1 af 4 · Konto"). `aria-label` som på tegnefladen. | Tom: ingen trin (skjult). |
| `TrustPanel` / `TrustRow` | Navy panel: logo-væg (kun tilgængelige connectors), eksempler, `ConnectionDiagram`, tre tillidspunkter. Mobil: logo-række, kort tillidslinje, lille navy diagramkort. | Indlæsning: logo-skeletons. Tom: kun tillidspunkterne. |
| `SsoButton` | Logo (`google.svg`, `microsoft.svg`) + label. Desktop "Fortsæt med Google". Mobil to kolonner med "Google"/"Microsoft" og `aria-label="Fortsæt med Google"`. | Indlæsning: spinner og disabled. Fejl: besked under knapperne. |
| `CodeInput` | 6 felter, `inputmode="numeric"`, `autocomplete="one-time-code"`, indsæt fordeler cifre, auto-videre, backspace tilbage. Én label for gruppen, fejl via `aria-describedby`. | Indlæsning (verificerer), fejl, udløbet. |
| `CvrField` | Input + opslag. `idle`, `searching`, `found` (navn, adresse, branche, "Fundet"), `not found` og `unavailable` → manuel indtastning (navn, adresse). Blokerer aldrig. | Alle fem. |
| `SystemPicker` | Logo-fliser, multivalg (`aria-pressed`), "Se alle N systemer" (N fra kataloget). | Indlæsning, tom (ingen valgt = ok), fejl. |
| `PlanCard` | `expanded` (pris, "Svarer til", features, "Anbefalet til jer", "Passer til …") og `collapsed` (mobilrække). `[ANTAL]` når værdien mangler. | Indlæsning, fejl. |
| `BillingPeriodToggle` | Segmenteret Månedligt / Årligt + "2 måneder gratis". Bygger på `Segmented`. | Disabled. |
| `OrderSummary` | Plan · periode, CVR, linjer, moms 25 %, "I alt i dag", fornyelse. Beløb i øre ind, formatering ud. | Indlæsning, fejl. |
| `TermsAcceptance` | Overskrift "Accept af betingelser", to obligatoriske afkrydsninger med links, fejl annonceres. | Fejl (ikke afkrydset ved forsøg). |
| `ConnectionDiagram` | Kilde → Agentor → destination (+ "Senere"), hver node grå/"Forbinder nu"/grøn "Forbundet". Tekstalternativ. | Indlæsning, fejl (rød node "Kunne ikke forbinde"). |
| `TemplateCard` | Logo-par, "Anbefalet" / "Kræver HubSpot", beskrivelse, rutechips. Radio-kort. | Disabled (mangler forbindelse), indlæsning. |
| `TestRunTable` / `TestRunList` | Tre tællere (Klar, Kræver en konto, Fejl), rækker med ordre, kunde, beløb, konto, resultat, inline "Vælg konto", "+ N ordrer klar". Mobil som liste med problemrækker øverst. | Indlæsning (kører), tom (ingen ordrer i kilden), fejl (testkørsel fejlede). |

Nye tokens kun i `theme.css`, ingen literals (lint `agentor/no-design-literals`).

---

## 7. Milepæle og acceptkriterier

Fælles for hver milepæl:
- Playwright ved 1440 × 900 (`desktop`) og 390 × 844 (`mobile-390`) for hver tegneflade. Screenshots i `docs/screenshots/signup/<board>.png` og ved siden af tegnefladen i PR'en.
- axe uden fund, synligt fokus, logisk fokusrækkefølge, fejl annonceres (`role="alert"`/`aria-live`), alle kontroller ≥ 44 × 44 på mobil, kontrast ≥ 4,5:1, ingen vandret scroll ved 390.
- Tenant-isolering for hvert nyt endpoint, hver action og hver tabel (isolation-suiten).
- `pnpm lint`, `typecheck`, `test`, `test:isolation` og e2e grønne. Røde tests rapporteres med output, ikke skjult.

### S1 – Signup-backend

Migrationer (§3), `emailOTP` + `socialProviders` + mock-SSO, `signupStep`-vagten, CVR-opslag til signup (kræver session, rate-limit 20 pr. time pr. bruger), `recommendPlan`/`recommendTemplate` som data, `legal_documents`/`terms_acceptances`, QuickPay-flowet (§4.2–4.3), aktivering i worker, `abandoned`-job i scheduler (efter Q1), DB-håndhævelse af "kun aktive tenants".

Tests:
- Callback: forkert, manglende og ændret signatur → 401 og intet job. Gyldig → ét job.
- Idempotens: samme callback to gange → én aktivering, én audit, én mail. "Payment" før "Subscription" → samme slutresultat.
- Redirect uden callback (`?return=1` uden callback) → tenanten er stadig `pending_payment`, `/` redirecter til `/signup/payment`.
- Rate limits: 2. kode inden for 60 s afvises; 6. kode i timen afvises; 6. verifikationsforsøg på samme kode afvises, også med rigtig kode.
- Ingen e-mail-enumeration: ny og eksisterende e-mail giver samme HTTP-svar, samme redirect, samme sidetekst, og svartiden ligger inden for samme interval.
- Ikke-aktiv tenant: INSERT i `connections`/`flows` fejler i DB, `requestRun` afviser, worker springer over.
- Kortdata: efter e2e indeholder logs (web, ingest, worker) og et `pg_dump` ingen af testkortnumrene og ingen CVC.
- `signupStep`: tabel-test over alle tilstande.

### S2 – Signup-UI (SU1–SU6, MS1–MS6)

| Tegneflade | Acceptkriterier |
| --- | --- |
| SU1 / MS1 | Logo øverst til venstre, "Har du allerede en konto? Log ind" øverst til højre. Overskrift og undertekst som tegnefladen. Google og Microsoft (desktop fuld bredde med "Fortsæt med …"; mobil to kolonner med "Google"/"Microsoft", `aria-label` "Fortsæt med …", ekstra luft over knapperne). "eller med e-mail", Dit navn, Email, Adgangskode ("Mindst 12 tegn. Du kan tilføje en passkey bagefter." på desktop). 20 px over "Opret konto" på mobil. Feltfejl ved blur og submit. Trin 1 af 4 (desktop top, mobil bund). Tillidspanel kun med tilgængelige connectors. |
| SU2 / MS2 | "Tjek din indbakke", e-mailen fra cookien. 6-cifret `CodeInput` (indsæt virker, auto-videre), "Bekræft". "send koden igen om 0:42" tæller ned fra serverens cooldown og bliver et link. Forkert/udløbet kode annonceres. "Det tager ca. 10 minutter" med fire punkter. "Næste: Virksomhed". SSO-brugere ser aldrig siden. |
| SU3 / MS3 | `CvrField` med alle fem tilstande; "Fundet" viser navn, adresse (og branche på desktop). Opslagsfejl → manuel indtastning, Fortsæt virker. `SystemPicker` med "Se alle N systemer". Ordrer pr. måned som tre valg. Sidepanelet viser den anbefalede kombination ud fra valget (opdateres live). Tilbage/Fortsæt. Valg gemmes og vises igen ved genbesøg. |
| SU4 / MS4 | Månedligt/Årligt, "2 måneder gratis". Priser ekskl. moms fra DB. Desktop: tre kort, "Anbefalet til jer" på den anbefalede. Mobil: anbefalet foldet ud, de andre som rækker, der kan foldes ud, "Sammenlign planer". "Passer til …" fra data. `[ANTAL]` når værdien mangler. Knappen "Fortsæt med Business årligt" følger valget. "Alle planer indeholder" (desktop). Ingen priser i koden (grep-test). |
| SU5 / MS5 | Ordreopsummering i øre med moms 25 % og "I alt i dag", "Fornyes …". Kortblok som informationskort (B3). "Accept af betingelser" med to obligatoriske afkrydsninger; betalingsknappen er disabled, indtil begge er sat, og serveren afviser uden. Acceptancen gemmes med version, tidspunkt og bruger og står i audit-loggen. Venter-, afvist-, annulleret- og "tager længere tid"-tilstande. Mobil: intet felt flyder ud over sit kort. |
| SU6 / MS6 | Logo øverst til venstre. "Velkommen, {fornavn}", virksomhed og plan, kvittering sendt til e-mail. Abonnement, betalt i dag, fornyes. "Næste skridt" med de valgte systemer og "{CRM} kan vente". "Start opsætningen · ca. 10 min." → `/onboarding/webshop` (eller MFA, Q4). Kun synlig når tenanten er `active`. |

e2e: e-mail-signup → kode fra Mailpit → CVR (fixture) → plan → betaling (mock, signeret callback) → aktiv → velkommen. Samme med Google (mock-IdP). Redirect uden callback forbliver ikke-aktiv. Forlad ved betaling, log ind igen → `/signup/payment` med samme valg.

### S3 – Onboarding (OB1–OB5, MO1–MO5), spring over og Overblik-påmindelse

| Tegneflade | Acceptkriterier |
| --- | --- |
| OB1 / MO1 | Webshoppen fra SU3 forvalgt og øverst ("Valgt ved oprettelse"). Andre tilgængelige webshops med deres auth-type fra manifestet. WooCommerce: "Butikkens adresse" (SSRF-tjek) og forbind (mock, B4). Kun de scopes, manifestet angiver, og de vises i teksten. Diagrammet: webshop "Forbinder nu" → grøn. "Spring over og gå til overblik" (mobil "Spring over"). Opsætning 1 af 4. |
| OB2 / MO2 | Grønt "forbundet"-banner med antal ordrer, kunder og produkter fra forbindelsestesten (uden tal, hvis kilden ikke kan tælle). Regnskabet fra SU3 forvalgt. Rettighedslisten som på tegnefladen. "Log ind hos Dinero" starter OAuth; på mobil i systembrowseren og tilbage til `/onboarding/accounting?done=1`. "Halvvejs" og diagrammet med webshop grøn. |
| OB3 / MO3 | Anbefalet skabelon fra `recommendTemplate`, andre med "Kræver {connector}" og disabled, hvis forbindelsen mangler. "Hvordan skal fakturaer oprettes i Dinero?" med "Som kladde, uden bogføring" valgt. "Brug skabelonen og testkør" opretter flowet som kladde (`createFromTemplate` uden redirect), gemmer `onboarding_flow_id` og starter testkørslen. |
| OB4 / MO4 | "Testkørsel med jeres 10 seneste ordrer". "Intet er skrevet til Dinero endnu." Tællere og rækker fra testkørslen. "Vælg konto" i rækken skriver kontoen til kladdens mapping og kører rækken igen. Desktop tabel, mobil liste med problemrækker øverst. "Gå live som kladde" publicerer med ERP-tilstand `draft` (Q12, Q15). Test: ingen skrivning til destinationen (adapterens skrive-tæller = 0). |
| OB5 / MO5 | Logo øverst til venstre. "Live som kladde", "Webshop → regnskab kører", "inden for N minutter" (N fra planens pollinginterval). "Gå til overblik". Invitér team (eksisterende invitation). "Tilføj {CRM}" for valgt CRM/marketing. Desktop QR-kode (Q17), mobil "Føj Agentor til hjemmeskærmen" → MA13-flowet. |
| Spring over | Findes på OB1–OB4. Sætter `onboarding_skipped_at`, lander på `/` med påmindelseskortet, indtil `onboarding_step = done`. Kortet fører tilbage til det aktuelle trin. Desktop og mobil. |

e2e: aktiv tenant → OB1 (mock-forbindelse) → OB2 (mock-OAuth) → OB3 → OB4 (testkørsel, intet skrevet) → live som kladde → OB5. Spring over → Overblik med påmindelse → fortsæt → samme trin.

### S4 – Oprydning, rutekort og demo-seed

- Fjern den gamle onboarding (§8) og opdatér rutekortet i `docs/CLAUDE-CODE-BUILD-PROMPT.md` §5, hvis noget er ændret.
- Seed `SEED_SCENARIO=signup`: tre fiktive brugere i hver sin tilstand (Nordlys Cykler, verificeret uden tenant; i `pending_payment`; aktiv midt i onboarding), ingen hemmeligheder.
- PR med screenshots ved siden af hver af de 22 tegneflader.

---

## 8. Det der fjernes fra den gamle onboarding (S4)

| Sti | Hvad |
| --- | --- |
| `apps/web/src/app/(focus)/onboarding/` | `page.tsx`, `company-step.tsx`, `plan/page.tsx`, `plan/plan-step.tsx`, `flow/page.tsx`, `flow/template-step.tsx`, `stepper.tsx`, `options.ts`, `actions.ts` (`lookupCvr` flyttes til signup) |
| `apps/web/src/app/(focus)/signup/` | Erstattes af `(signup)/signup/` |
| `apps/web/src/components/billing/plan-cards.tsx` | `PlanRadioCards` (kun brugt af onboarding) |
| `packages/db/src/repo/onboarding.ts` | `completeOnboarding` (erstattes af onboarding-trin); `createCompany` ændres til signup |
| `packages/i18n/messages/{da,en}.json` | Navnerummene `onboarding` og `signup` erstattes af `signupFlow` og `onboardingFlow`. `onboarding.templates.*` flyttes først til `templates` (bruges af `empty-flows.tsx` og `template-picker.tsx`). |
| `packages/ui/src/styles/theme.css` | `--container-onboarding-narrow`, hvis ubrugt. `--container-onboarding` bruges af editorens skabelonvælger og bliver. |
| `apps/web/e2e/billing.spec.ts:19-102`, `screenshots.spec.ts:55-96`, `docs/screenshots/D14-Onboarding-{1,2,3}.png` | Erstattes af de nye specs og screenshots |
| `apps/web/src/components/mobile/desk-only.tsx` | Området `signup` og dets i18n-tekst (efter aftale med mobilsessionen, §9) |
| Redirects | `signup/actions.ts` (`callbackURL: '/onboarding'`), `session.ts:127` (`/onboarding`), `(app)/layout.tsx:26` (`/onboarding/plan`) peger på vagten |

`recommendPlan`, `cvr.ts`, `startCardSetup` og `tenants.onboarding_completed_at` bliver og ændres.

---

## 9. Samspil med mobilsessionen

- PLAN-MOBILE §1 lister `/onboarding/*` og `/signup` som desktop-only. Med beslutning 22 får de en mobilgren i denne plan. Jeg retter den ene linje i PLAN-MOBILE §1 og fjerner `signup` fra `DeskArea` i S4, medmindre mobilsessionen hellere vil gøre det.
- Jeg ændrer ikke `@agentor/ui/mobile`-komponenterne. Mangler noget, laves det i `@agentor/ui/signup`.
- MO5 "Føj Agentor til hjemmeskærmen" linker til mobilsessionens `/install` (MA13).
- OAuth i systembrowseren følger samme mønster som MA08 (`?done=1`-retur).

---

## 10. Afvigelser mellem kilderne, som jeg har afgjort

| Emne | Kilder | Afgjort |
| --- | --- | --- |
| Hvor signup ligger | spec §6: www.agentor.dk · beslutning 21 og prompten: app.agentor.dk | app.agentor.dk |
| Betingelser | gammel signup: ved oprettelse · prompten og SU5: kun ved betaling | Kun ved betaling |
| "Se alle 22 systemer" | SU3: 22 · kataloget: 23 | Tallet kommer fra kataloget |
| Ordre-intervaller | data: 0-200/200-1000/1000+ · SU3: under 100/100–1.000/over 1.000 | Tegnefladen (§3.4) |
| Testkørsel | spec §5.4: seneste *n*, standard 10 · OB4: 10 seneste ordrer | 10, som i dag |

---

## 11. Beslutninger (20. okt. 2026)

| # | Emne | Beslutning | Betyder for planen |
| --- | --- | --- | --- |
| B1 | Forladte signups (Q1) | Ingen værdi i at gemme dem. Slettes efter 24 timer; brugeren tilmelder sig igen. | Ingen `abandoned`-tilstand. `app.signup_purge()` sletter hårdt 24 timer efter at kontoen blev oprettet (§3.1). e2e "forlad ved betaling og genoptag" kører inden for 24 timer; en ny test dækker sletningen efter 24 timer (med flyttet ur). |
| B2 | CVR (Q2) | Datafordeler. Det ældre CVR-system lukkes næste år. | `CVR_PROVIDER=datafordeler` mod Datafordelers nye CVR-tjeneste. Feltnavnene i `cvr.ts` verificeres mod Datafordelers dokumentation i S1, før FOLLOW-UP-noten fjernes. Fixture i dev og CI. |
| B3 | Betalingsvindue (Q3) | Forslaget: QuickPays hostede vindue. | SAQ A. Kortblokken på SU5/MS5 bliver et informationskort ("Du indtaster kortet hos QuickPay i næste trin"). MS5-noten om udløb/CVC bortfalder. |
| B4 | WooCommerce og e-conomic (Q7) | Ingen rigtige integrationer endnu. Dummydata, indtil hver integration er klar. | Onboarding kører på `CONNECTOR_MODE=mock`. Hver forbindelse vises, som tegnefladen viser den ("Du sendes til WooCommerce", "Log ind med e-conomic"), og ender i mock-samtykke eller -nøgle. TODO T1. |
| B5 | Connectors, der ikke findes (Q8) | Behold tegnefladerne, som de er. Connectorerne kommer snart. | Logovæg, SU3, OB1 og OB2 viser de systemer, tegnefladerne viser (også Magento, PrestaShop, DanDomain, Billy, Fortnox, Klaviyo), alle på dummydata. Reglen "logoer kun for connectors, der findes" er dermed udsat. TODO T2. |
| B6 | Betingelser (Q9) | Versioner og links kommer senere. De ligger på agentor.dk og vises i en modal, hvor de accepteres. | `legal_documents` får URL fra konfiguration (`LEGAL_SUBSCRIPTION_TERMS_URL`, `LEGAL_PRIVACY_URL`, valgfri `LEGAL_DPA_URL`). Modalen viser dokumentet i en sandboxed iframe fra agentor.dk (`frame-src https://agentor.dk` i CSP; agentor.dk skal tillade framing fra app.agentor.dk). Versionen, der gemmes ved accept, er dokumentets versionsfelt, hvis agentor.dk leverer et, ellers SHA-256 af indholdet, som serveren henter i accept-øjeblikket. Indtil URL'erne findes, viser modalen pladsholderen `[Abonnementsbetingelser]`/`[Privatlivspolitik]`. TODO T3. |
| B7 | Enterprise (Q10) | Kort. | Selvbetjening er kun kort for alle planer. EAN er ikke en del af signup. |
| B8 | Eksisterende tenants (Q11) | Ingen rigtige kunder endnu. | Migrationen sætter alle eksisterende tenants til `active`. |
| B9 | MFA for ejeren (Q4) | Mellem SU6 og OB1. | "Start opsætningen" → eksisterende MFA-opsætning (D14-MFA) med passkey først og TOTP som alternativ → `/onboarding/webshop`. Signup-ruterne før SU6 kræver ikke MFA. "Spring over" fra onboarding kræver stadig MFA før app'en (eksisterende regel). |
| B10 | Login for SSO-brugere (Q5) | Anbefalingen. | "Fortsæt med Google" og "Fortsæt med Microsoft" på `/login` (desktop og MA01) med `SsoButton`, under formularen som på SU1. Ejer og Admin skal efter SSO-login stadig bekræfte med passkey eller TOTP: sessionen får `mfaVerifiedAt`, og `requireAppContext` kræver den for de to roller. Afvigelse fra D14-Login/MA01, godkendt her. |
| B11 | OAuth (Q6) | Anbefalingen. | S3 bygger den generiske OAuth-del: `/connect/[connector]/start` (state + PKCE i Redis, bundet til bruger, tenant og retur-trin, 10 min) og `/connect/[connector]/callback` (tjekker state, bytter kode, forsegler nøgler i keybox, opretter forbindelsen). Retur afhænger af state, ikke af cookien, så det virker fra systembrowseren på iPhone; Safari viser "Gå tilbage til appen", og app'en henter status. Kører mod en mock-udbyder, der opfører sig som en rigtig (redirect, kodebytte). Pr. system: T1. |
| B12 | Version af betingelser (Q9) | Versionen vises på agentor.dk. | Serveren henter dokumentet i accept-øjeblikket og læser versionen derfra. Formatet aftales (forslag: `<meta name="agentor-document-version" content="…">`). Mangler versionen, afvises accepten med en fejl i stedet for at gemme en ukendt version. Indtil da: version fra konfiguration i dev/test. TODO T3. |

**Standarder for de spørgsmål, der kan afgøres senere (Q12–Q19):** jeg følger forslagene i parentes i §13, indtil du siger andet.

## 12. TODO til senere

Markeres også `FOLLOW-UP` i koden, som i resten af repoet.

| # | TODO |
| --- | --- |
| T1 | Rigtige integrationer: erstat dummydata pr. connector (WooCommerce via WooCommerces godkendelsesflow, e-conomic via app-token-flowet, Shopify, Dinero og HubSpot via OAuth). Ret manifestets auth-type, så den passer til tegnefladens tekst. |
| T2 | Når en "På vej"-connector ikke er klar ved lancering: skjul den på logovæggen og i SU3/OB1/OB2, eller mærk den "På vej". Gennemgå før go-live. |
| T3 | Betingelser: indsæt de rigtige URL'er og versioner, når agentor.dk publicerer dem. Afgør, om Databehandleraftalen skal accepteres ved betaling. Tjek, at agentor.dk tillader framing fra app.agentor.dk. |

## 13. Åbne spørgsmål

Q1–Q11 er besvaret (§11, B1–B12). Intet blokerer S1.

**Kan afgøres senere (forslag i parentes):**

12. **"Bogfør med det samme" i OB3.** (Knappen på OB4 bliver "Gå live" med eksplicit bekræftelse som i spec §5.4.3, og OB5 viser "Live" i stedet for "Live som kladde".)
13. **"Du får besked 14 dage før"** (SU5/MS5) findes ikke. (Jeg bygger en scheduler-mail 14 dage før fornyelse af årlige abonnementer. Månedlige får ingen.)
14. **[ANTAL] for Enterprise.** Data har 2000 transaktioner, så pladsholderen vises ikke. (Følg data.) Enterprise-kortet siger "SSO og white-label", men white-label er et ikke-mål i v1 (spec §2). Teksten kommer fra `features`-data; skal `whiteLabel` ud af Enterprise?
15. **Gå live med en række, der kræver konto** (OB4). (Knappen er aktiv; rækken uden konto holdes tilbage som fejl, til kontoen er valgt. Alternativt disabled, til "Kræver en konto" er 0.)
16. **Tekster.** (a) OB5 "så hun får besked" foreslås kønsneutral som MO5: "så fejl når frem med det samme". (b) Tillidspunkterne er "Data opbevares i EU · Nøgler krypteres pr. kunde" på desktop og "Data i EU · Krypterede nøgler" på mobil; prompten nævner den korte form. (Hver tegneflade sin egen.) (c) SU2–SU5 siger "Har du en konto?", SU1 og mobil "Har du allerede en konto?". (Brug "Har du allerede en konto? Log ind" overalt.) (d) SU3 "Det er en af de mest brugte kombinationer" kan vi ikke dokumentere. (Fjern sætningen.) (e) SU1's levende eksempler ("Ordre #10460 bogført … for 2 min. siden") er opdigtede. (Mærk dem "Eksempel".)
17. **QR-kode på OB5** kræver en QR-generator. (Ingen ny afhængighed: én statisk SVG for `https://app.agentor.dk`, genereret én gang og committet.)
18. **MobilePay.** Beslutning 18 nævner stadig kort eller MobilePay. (Prompten vinder: kun kort. Beslutning 18 rettes i README, hvis du vil.)
19. **QuickPay test-mode** kræver en offentlig callback-URL. Findes der et staging-miljø med offentlig ingest, hvor `@quickpay-test` kan køre?
20. **Kvitteringsmail ved aktivering.** SU6 siger "Kvitteringen er sendt til …", men worker'en, der aktiverer tenanten, har ingen mail-forbindelse (kun web sender mail i dag). (Forslag: web sender kvitteringen én gang, første gang en side ser tenanten som aktiv, med en idempotent markering. Alternativet er SMTP i worker'en, som kræver nodemailer i worker-pakken.)

## 14. Status for S1 (20. okt. 2026)

Bygget på `v1.0`, ikke committet.

- **Database** (`0038_signup`, `0039_signup_security`, `0040_signup_sessions`):
  - `tenants.signup_state` (`pending_plan | pending_payment | active`), `chosen_connectors`, onboarding-kolonnerne og `terms_acceptances`.
  - En trigger gør, at kun ejer-funktionerne kan ændre `signup_state`.
  - Restriktive INSERT-politikker på `connections`, `connection_secrets`, `flows`, `flow_versions` og `runs` via `app.tenant_is_active()`.
  - Nye funktioner: `app.create_tenant` (med systemvalg og højst én ubetalt virksomhed pr. bruger), `app.signup_plan_chosen`, `app.signup_activate`, `app.signup_payment_activity` og oprydningen (`app.pending_signups`, `signup_purge_candidates/tenant/users`).
  - Ordre-intervaller som på SU3 og `recommended_for_systems` som data.
  - Kun PG12-kompatibel SQL. Lokalt testet på PG16.
- **Core:** `currentSignupStep`, `canOpenSignupStep` og `signupRedirect` (vagten) samt `recommendPlan` med ordrer og antal systemer.
- **Repo:** `repo/signup.ts`.
  - Billing: under signup forbliver abonnementet `incomplete`, første periode opkræves med det samme, og en fejlet første betaling får hverken 2/5/9-genforsøg eller ejer-notifikation.
  - Et nyt kort annullerer (voider) den fejlede faktura.
- **Worker:**
  - Opkræver straks ved godkendt kort.
  - Aktiverer kun fra et verificeret Payment-callback, aldrig fra det synkrone svar.
  - Har `signup.purge` (kortet annulleres hos QuickPay før sletning).
  - Scheduler'en lægger purge-jobbet i kø hvert 15. minut.
- **QuickPay:** `payment_methods: 'creditcard'` og `cancelSubscription`. Mock-tilstanden sender det signerede Payment-callback gennem den rigtige ingest.
- **Web:**
  - Better Auth `emailOTP` (6 cifre, 10 min, 5 forsøg, hashed) med alle e-mail-OTP-HTTP-stier lukket. De kunne ellers logge ind med kun en kode.
  - Google/Microsoft (`SSO_MODE=live`) eller mock-IdP (`SSO_MODE=mock`, `/dev/oauth/*`).
  - `sessions.sso_login` og `mfa_verified_at` (B10).
  - Vagten i `requireAppContext` og `(app)`-layoutet, `server/signup.ts` (ventende signup i Redis bag signeret cookie; adgangskoden sættes først, når koden bekræftes) og `server/legal.ts` (version fra agentor.dk).
  - Server actions i `(signup)/actions.ts` til S2.
- **Tests:**
  - Core 45, billing 10, worker 12, ingest 10 (signatur, manipuleret body, samme callback to gange) og web 17.
  - Isolation 518 (ny `signup.test.ts` og omskrevet `billing-flow.test.ts`).
  - Typecheck, lint og format er grønne.
  - Playwright desktop: 71 bestået, 7 sprunget over (6 fra før, plus den gamle D14-signuptest, som er markeret som erstattet og fjernes i S2), 0 fejlet.

Ikke gjort endnu / kendt:

- **Den gamle onboarding** (`(focus)/onboarding/*`, `(focus)/signup`) er død mellem S1 og S2/S3. Den bruger det gamle flow, og en tenant oprettet der kan ikke blive aktiv. Den fjernes, når de nye sider findes.
- **Datafordeler:** feltnavnene i `cvr.ts` er stadig ikke verificeret. Den offentlige dokumentation viser ikke skemaet; det kræver introspection med en API-nøgle (FOLLOW-UP, B2). Branche (`industry`) findes kun i fixture.
- **QuickPay test-mode** er ikke kørt (Q19).
- **Kvitteringsmail** mangler (Q20).
- **"Kortdata findes ikke i logs og DB"** testes i S2's e2e (kræver hele flowet).
