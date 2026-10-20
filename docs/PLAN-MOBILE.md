# PLAN-MOBILE: mobil og PWA (M11)

Status: **godkendt 19. okt. 2026. M1 bygget 20. okt. 2026 (ikke committet), se §12.** Base: branch `v1.0`. Intet pushes til `main`.

Kilder: `docs/design/runde-1/README.md` beslutning 16, 18, 19 og 20, de 22 mobile tegneflader (`MA01`–`MA15`, `MP01`–`MP07`, alle 390 × 844), desktop-tegnefladerne for de samme funktioner, produktspecifikation §6, §7, §8, §9.5–9.7 og designspecifikation §2, §3.1, §5.4–5.6, §8, §9, §10.1.

Regel ved konflikt: under 768 px vinder mobiltegnefladen på layout. På data og regler vinder spec og README-beslutningerne. Beslutning 20 vinder over spec §8 og designspec §8 (fx faner: **Mere** + klokke i stedet for en Notifikationer-fane, og topbar 60 px / tabbar 76 px som på tegnefladerne).

---

## 1. Responsivt skift: ét rutetræ med to visninger

**Forslag:** samme rutetræ (`(app)` og `platform`). Hver side henter sine data én gang på serveren og returnerer

```tsx
<Responsive mobile={<FlowMobile data={d} />} desktop={<FlowDesktop data={d} />} />
```

`Responsive` (packages/ui) lægger de to grene i hver sin container: `md:hidden` for mobil og `max-md:hidden` for desktop. Layoutet gør det samme med skallen: `MobileShell` under 768 px og den nuværende `AppShell` over.

Hvorfor:

1. **En parallel rutegruppe kan ikke lade sig gøre uden omveje.** To route groups (`(app)` og `(mobile)`) må ikke løse til samme URL i Next. Det kræver en UA-rewrite i `proxy.ts` til fx `/m/...`, og så har vi to rutetræer, to sæt permission-kald og en visning, der er forkert, når man drejer en iPad eller ændrer vinduesbredden.
2. **UA-gæt på serveren** giver forkert visning ved resize og hydrerings-mismatch, hvis man retter til på klienten.
3. **CSS-skiftet er deterministisk ved 768 px**, virker ved resize, og `display: none` fjerner den skjulte gren fra tab-rækkefølgen og tilgængelighedstræet.
4. **Samme server-loader og samme server actions** for begge grene. Permission-tjek ligger ét sted, og UI'et bestemmer kun, hvad der vises (princip 2).

Prisen er, at HTML'en indeholder begge grene. Det holdes nede ved at:

- desktop-only tunge klientkomponenter (editor, DataTable, grafer) ikke findes på mobilgrenen og loades med `next/dynamic` i desktopgrenen, hvor det betaler sig;
- mobilgrenen kun renderer det, tegnefladen viser (ingen tabeller, ingen KPI-dæk);
- vi måler HTML-størrelse på `/`, `/integrations` og `/integrations/[id]` før og efter og rapporterer tallet i PR'en.

Desktop-only ruter (`/integrations/[id]/editor`, `/integrations/new`, `/integrations/templates`, `/activity/reconciliation`, `/settings/team`, `/settings/security`, `/settings/audit-log`, `/settings/company`, `/onboarding/*`, `/signup`, `/platform/time/*`, `/platform/users/*`, `/platform/settings`, `/platform/finance/{subscriptions,support,reports,customers}` og supportvisningen) får på mobil én fælles skærm: `DeskNote` + "Send link til min computer".

Mobile-only ruter (`/more`, `/install`) og nye ruter (`/notifications`, `/support-access/[grantId]`, `/connections/[id]/reconnect`, `/integrations/[id]/runs/[runId]`) har også en desktopgren, så et link sendt fra telefonen virker på computeren:

| Rute | Desktop ≥ 768 px |
| --- | --- |
| `/notifications` | Notifikationscenter som fuld side (sitemap §6) med samme liste som D2-popoveren |
| `/support-access/[grantId]` | Kort med samme indhold som MA12 og samme action som D8/Sikkerhed |
| `/connections/[id]/reconnect` | Redirect til `/connections/[id]` (D9-Dinero-Afbrudt) |
| `/integrations/[id]/runs/[runId]` | Redirect til D8-Kørsler med kørslen valgt |
| `/more`, `/install` | Redirect til `/` |

## 2. Fundne tegneflader

Alle 22 findes i `docs/design/runde-1/boards/`: MA01-Log-ind, MA02-Overblik, MA03-Overblik-Problemer, MA04-Integrationer, MA05-Flow, MA06-Fejl, MA07-Aktivitet, MA08-Genforbind, MA09-Notifikationer, MA10-Mere, MA11-Notifikationsindstillinger, MA12-Supportadgang, MA13-Installer, MA14-Push, MA15-Abonnement, MP01-Kunder, MP02-Sager, MP03-Sag, MP04-Tid, MP05-Fejl, MP06-Finans, MP07-Forfaldne. Ingen mangler. De 22 rensede logoer ligger i `docs/design/runde-1/logos/` og er allerede kopieret til `apps/web/public/logos/`.

## 3. Hvad der allerede findes og genbruges

| Behov | Findes |
| --- | --- |
| Passkey-login | `@better-auth/passkey`, `authClient.signIn.passkey()` i `login-form.tsx` |
| Gentag, pause, genoptag | `retryFailures`, `pauseFlows`, `resumeFlows` i `(app)/integrations/actions.ts` |
| Genforbind | `connections/actions.ts` (OAuth-start og `reconnectWithKey`) |
| Godkend/afvis supportadgang | `decideSupport` → `decideSupportGrant` (audit `support.approved/denied`) |
| Notifikationer | tabellen `notifications`, `listNotifications`, `markNotificationsRead`, klokken |
| Præferencer og stille timer | `notification_prefs` (inApp/email/push/sms pr. hændelse), `notification_settings` (quiet 22:00–07:00) |
| Kortskift | `changeCard` (QuickPay hosted page), faktura-PDF-ruten |
| Sager, timer, tid | `listCases`, `getCase`, `addCaseEvent`, `createCase`, `startTimer`/`stopTimer`, `addTime` |
| Fejl på tværs | `errorGroups` (kun koder og antal) |
| Finans | `platform/finance` data + `notifyInvoiceAction` (rykker og betalingslink, superadmin) |
| Komponenter | `ConnectorLogo`, `StatusPill`, `Switch`, Radix `Dialog`, `states.tsx`, KPI-anatomi i `dashboard.tsx` |
| Komponentside | `/dev/components` (vi tilføjer `/dev/mobile`, ingen Storybook-afhængighed) |

## 4. Komponenter (packages/ui, `mobile/`)

Bygges én gang og matches pixel for pixel ved 390 px. Kun design-tokens (lint). Alle lister og kort har indhold, skeleton, tom og fejl.

| Komponent | Indhold og krav |
| --- | --- |
| `MobileShell` | Topbar 60 px + indhold + tabbar 76 px + `env(safe-area-inset-*)`. Variant `platform` (navy). Offline-banner-slot. |
| `TopBar` | Logo-variant, eller tilbage-knap + titel + undertitel. Klokke med badge (rød ved fejl/afbrudt, ellers mørk, beslutning 4). Navy-variant med Platform-mærke og avatar. |
| `TabBar` | 4 faner, aktiv = lime pill bag ikonet (navy pill på Platform). `<nav>` med `aria-current`. Finans-fanen renderes kun for Superadmin. |
| `StatusHero` | Cirkelikon + overskrift + meta (MA02 "Alt kører", MA03 "2 ting kræver handling", MA05). |
| `RowLink` | 56 px række: ikon eller logo, titel + meta, efterfølgende chevron, pill eller knap. Hele rækken er ét `<a>`; en knap i rækken er en søskende, ikke indlejret. |
| `FlowCard` | Logoer kilde → destinationer, statuspill, navn, meta (MA04). |
| `ConnectorLogo` | Genbrug, BC-fallback med initialer. |
| `MobileKpi` | Label + trendpill, værdi, sparkline, meta. Variant `featured` (lime). |
| `MobileRing` | Ring med værdi og "af N" (Transaktioner). |
| `WeekBars` | 7 dage, i dag skraveret, rød top på dage med fejl, tekstalternativ. |
| `SectionHeading` | 12/700, versaler, `#1A1A18`, 14 px top. |
| `DeskNote` | Grå computer-linje, valgfri "Send link til min computer". |
| `ChipGroup` | Filterchips med tal (Alle 6 · Problemer 2 · Pauset 1), `aria-pressed`. |
| `Switch` | Genbrug, 44 px trykflade. |
| `BigButton` | 52 px, primær/sekundær/destruktiv, busy-tilstand. |
| `Modal` | Centreret, 20 px radius, lukkeknap, fokusfælde, Esc og klik på baggrund lukker (Radix Dialog). |
| `ChatBubble`, `InternalNote` | Kunde/Agentor-bobler, gul intern note (#FBF0DC-token) med "Intern note". |
| `OfflineBanner` | Gråt banner med tidspunkt, handlinger deaktiveres. |
| `Responsive` | Se afsnit 1. |

Tilgængelighed: trykflader ≥ 44 px, rigtige `<button>/<a>/<input>` med labels, synlig fokus (2 px ring, hvid på navy), status altid ikon + tekst + farve, `prefers-reduced-motion`, tekstkontrast 4,5:1.

## 5. Milepæle

### M1 – Skal og komponenter

- `Responsive`, `MobileShell`, `TopBar`, `TabBar` og alle komponenter fra afsnit 4.
- `/dev/mobile` viser hver komponent i hver tilstand (indhold, skeleton, tom, fejl, disabled/offline) ved 360, 390 og 430 px.
- Desktop-only-skærmen og `sendDeskLink`-action (se afsnit 7).

Accept:
- Playwright: `/dev/mobile` ved 360 × 780, 390 × 844 og 430 × 932 uden horisontal scroll; axe uden fejl.
- Skift ved præcis 767/768 px: kun én skal er synlig, og fokus når aldrig den skjulte gren.
- Lint (kun tokens), typecheck og eksisterende e2e er grønne. Desktop-screenshots er uændrede.

### M2 – Kundens app (MA01–MA15)

Mod seedede Nordlys Cykler-data (designspec §10.1). Gentag, pause, genforbind og supportgodkendelse kalder **de samme server actions som desktop**.

| Tegneflade | Rute | Acceptkriterier |
| --- | --- | --- |
| MA01 Log ind | `/login` | "Log ind med passkey" (aldrig "Face ID" i knappen), hjælpelinjen som på tegnefladen, "Log ind med e-mail og kode" åbner fallback (se gap G2), ingen opret-knap, kun linjen "Ny bruger? Opret konto på app.agentor.dk fra en computer." |
| MA02 Overblik | `/` | Hilsen + tenant, `StatusHero` "Alt kører", `MobileKpi` featured (Records i dag + trend + sparkline), `MobileRing` (Transaktioner af kvote, nulstillingsdato), `WeekBars`, Seneste aktivitet (2 rækker). Bell-badge = antal "kræver handling". |
| MA03 Overblik, problemer | `/` | Hero "N ting kræver handling", et kort pr. problem; afbrudt forbindelse har "Genforbind" → MA08, fejl → MA06. Flows-liste med status. |
| MA04 Integrationer | `/integrations` | Chips Alle/Problemer/Pauset med tal (URL-param, så filter overlever reload), `FlowCard`s, `DeskNote`. Kun læsning. |
| MA05 Flow | `/integrations/[id]` | Status, Sidst kørt, Records i dag; "Gentag N fejlede" (skjult ved 0), "Pausér flow"/"Genoptag flow" med toast + Fortryd 6 s (designspec §5.5); ruteliste kun læsning med statuspill og tilstand (Live/Test/Kladde); `DeskNote`. Knapper skjules for Læser (samme rolle-tjek som desktop). |
| MA06 Fejl | `/integrations/[id]/runs/[runId]` | Hvorfor + Sådan løser du det (forklaringstekster fra M3-fejlkataloget), fejlede records (ordrenr., vare, beløb, land, ingen navne), "Gentag N ordrer", "Send link til min computer". |
| MA07 Aktivitet | `/activity` | Chips Alle/Fejl/Flow (Flow åbner en modal med flows, B10), grupperet I dag/I går. Kun læsning. |
| MA08 Genforbind | `/connections/[id]/reconnect` | Forklaring, antal ventende records, "Log ind hos {connector}" starter OAuth i systembrowseren og vender tilbage til `/connections/[id]/reconnect?done=1` → toast og tilbage til flowet; "Senere". API-nøgle-connectors henvises til computer. |
| MA09 Notifikationer | `/notifications` | Liste fra `notifications`, "Marker alle læst", hver række deep-linker (`href`), ulæst-markering, link "Vælg hvad du får besked om" → MA11. |
| MA10 Mere | `/more` | Profilkort, rækker som på tegnefladen, badge på Supportadgang, "Log ud" (rydder offline-cache og afmelder push på enheden). |
| MA11 Notifikationsindstillinger | `/settings/notifications` (mobilgren) | Push-switches pr. hændelse på **denne enhed**, stille timer med tekst "22.00–07.00 · fejl samles til morgen", `DeskNote` om e-mail og SMS. Viser om push er tilgængelig (ikke installeret på iOS, afvist, ikke understøttet) med link til MA13. |
| MA12 Supportadgang | `/support-access/[grantId]` | Medarbejder, sag, hvad de kan/ikke kan (fra `scope`), varighed (højst 24 t), audit-linjen; "Afvis"/"Godkend" kalder `decideSupport`; udløbet/allerede besluttet anmodning viser en tilstand i stedet for knapper. Kun Ejer/Admin (samme tjek som desktop). |
| MA13 Installer | `/install` | iOS-trin og Android-linje; skjules (redirect) når `display-mode: standalone`; Android viser `beforeinstallprompt`-knap, hvis den findes. "Jeg har gjort det" gemmer et lokalt flag. |
| MA14 Push | (ingen rute) | Reference for tekster og deep links i M3. Gengives på `/dev/mobile`. |
| MA15 Abonnement | `/billing` (mobilgren) | Plan + interval + status, transaktioner, support i måneden, betalingskort med "Skift kort" (QuickPay hosted), næste opkrævning, seneste fakturaer med PDF-download, `DeskNote` om planskift. |

E2e (390 × 844 og 360 × 780, screenshot pr. tegneflade ved siden af tegnefladen i PR'en):
- MA03 → MA06 → "Gentag 3 ordrer" → records i kø, toast vist, status opdateret.
- MA03 → "Genforbind" → mock-OAuth → tilbage → forbindelsen er aktiv.
- Læser ser ingen Gentag/Pause-knapper, og et direkte kald til actionen afvises.

### M3 – PWA og push

**Manifest** (`app/manifest.ts`): name "Agentor", short_name "Agentor", `theme_color` lime-token, `background_color` canvas, `display: standalone`, `start_url: /`, `scope: /`, ikoner 192/512 + maskable 512. Ikoner: lime felt med "A" (B9).

**Service worker** (`public/sw.js`, håndskrevet, ingen afhængighed):
- Cacher kun app-skallen (statiske `_next/static`-assets, ikoner, fonte, offline-side).
- Cacher **aldrig** HTML med data, API-svar, server action-svar, `/api/auth/*` eller PDF'er (spec §8).
- Offline-data: et "sidst kendte" snapshot i IndexedDB nøglet `user_id:tenant_id` med kun aggregater og visningstekster for Overblik, Integrationer og Aktivitet (ingen request/response-bodies, ingen persondata). Det skrives af klienten efter en vellykket indlæsning og vises med `OfflineBanner` "Offline · data fra kl. 14:02" (B2), og alle handlinger er deaktiveret.
- Ryddes ved logout, ved tenant-skift, ved bruger-skift og ved 401.
- CSP: `worker-src 'self'` tilføjes i `proxy.ts`; `sw.js` serveres med `Service-Worker-Allowed: /` og `Cache-Control: no-cache`.

**Web Push (VAPID):**
- Ny tabel `push_subscriptions` (tenant-scoped, FORCE RLS): `tenant_id, id, user_id, endpoint, p256dh, auth, user_agent_label, events jsonb, created_at, last_seen_at, failed_at`. Unik på `(tenant_id, user_id, endpoint)`. Endpoint og nøgler logges aldrig.
- `events` er enhedens toggles (MA11). Stille timer bruger den eksisterende `notification_settings` pr. bruger.
- VAPID-nøgler i env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), aldrig i repo; `env.ts` validerer dem.
- Server actions: `subscribePush`, `unsubscribePush`, `setDevicePushEvents`. Afmeldes ved logout.
- Worker-job `push.deliver` fan-out: hændelse → modtagere efter roller og præferencer → stille timer → send. 404/410 fra push-tjenesten sletter abonnementet.
- Stille timer: fejl i perioden samles til én besked ved `quiet_end` ("N fejl i nat · tryk for at se"). Supportadgang sendes altid med det samme (B7).
- Payload: `{ title, body, url, tag }` på dansk via next-intl-kataloget, **ingen persondata** (ordrenumre er tilladt, navne/e-mail/adresser aldrig). `url` er altid en relativ app-sti, valideret med `safe-next`.

Hændelser og tekster (MA14):

| Hændelse | Ny i `NOTIFICATION_EVENTS`? | Standard push | Deep link |
| --- | --- | --- | --- |
| Fejl i et flow | nej (`systematic_error`/`record_failed`) | til | `/integrations/[id]/runs/[runId]` |
| Afbrudt forbindelse | nej (`connection_broken`) | til | `/connections/[id]/reconnect` |
| Supportadgang anmodet | **ja** `support_access_requested` | til (Ejer/Admin) | `/support-access/[grantId]` |
| Kvote over 80 % | nej (`quota`) | til, én gang pr. måned | `/billing` |
| Fejlen er løst | **ja** `error_resolved` | til | `/integrations/[id]` |
| Ugens opsummering | nej (`weekly_summary`) | **fra**, mandag kl. 08 | `/` |

Accept:
- Manifest og SW registreres; installérbarhed tjekkes i Chromium (manifest gyldigt, SW kontrollerer siden, ikoner findes).
- Offline: Playwright `context.setOffline(true)` → Overblik, Integrationer og Aktivitet vises fra snapshot med banner; handlinger er disabled; andre tenants' snapshot er ikke læsbart.
- Push e2e: hændelse udløses → worker sender til en lokal test-push-modtager, der fanger payload (ingen persondata, korrekt `url`) → Playwright leverer beskeden til SW med CDP `ServiceWorker.deliverPushMessage` → `notificationclick` åbner MA12 → "Godkend" → `support.approved` står i kundens audit-log med medarbejderens navn.
- Stille timer: fejl kl. 23:00 sendes ikke, én samlet besked kl. 07:00 (testet med fast ur).
- Isolationssuite: `push_subscriptions` i tenant-tabel-listen; bruger A kan ikke læse, ændre eller slette B's abonnement, heller ikke i samme tenant; fan-out sender aldrig til et abonnement i en anden tenant; deep links til en anden tenants ressource giver 404; IndexedDB-nøgler inkluderer tenant og ryddes ved skift.

### M4 – Agentor Platform (MP01–MP07)

Samme rolle-tjek som desktop (`getStaffRole`, `requireSuperadmin`). Supportere uden aktiv adgang ser ingen tenant-data.

| Tegneflade | Rute | Acceptkriterier |
| --- | --- | --- |
| MP01 Kunder | `/platform/customers` | Søgning, chips "Kræver opmærksomhed" og "Mine adgange", rækker med kun navn, plan/adgangsstatus, antal fejl og samlet status (som desktop P1). `DeskNote` om supportvisning. |
| MP02 Sager | `/platform/cases` | Liste i stedet for tavle, chips Mine/Ikke tildelt/Venter, "Din tid i dag", prioritet uden statusfarver (beslutning 17), svarfrist. "Ny sag" (se G8). |
| MP03 Sag | `/platform/cases/[id]` | Tidslinje med `ChatBubble`, `InternalNote` (gul, aldrig til kunden), auto-loggede sessioner; komponist med "Svar kunden"/"Intern note"; timer-bar "00:12:40 på sagen" + "Stop og gem". |
| MP04 Tid | `/platform/cases/[id]` + modal | `Modal` over den dæmpede sag: varighed forudfyldt fra timeren rundet op til nærmeste 15 min. (12 min. 40 s. → 0:15), kan overskrives (B1), hurtigvalg 15 min./30 min./1 time, type Telefon/E-mail/Afklaring/Andet, beskrivelse, "Fakturerbar tid" med kundens plan, Annullér/Gem. Gem stopper timeren og logger tiden i én transaktion. |
| MP05 Fejl | `/platform/errors` | 3 tal (records fejlet, kunder ramt, uden sag), grupper med kode, forklaring, antal kunder, antal og trend. "Viser kun fejlkoder og antal, aldrig kundedata." |
| MP06 Finans | `/platform/finance` | Kun Superadmin (fanen og ruten). Én liste med nøgletal + trendpills (featured først), "Kræver handling", `DeskNote` om rapporter/afregning/kladder. |
| MP07 Forfaldne | `/platform/finance/invoices?status=overdue` | Fakturaer med beløb inkl. moms, status (Forfalden N dage, Rykker N sendt, Kort afvist, Prøver igen), "Send rykker"/"Rykker N"/"Betalingslink" med bekræftelsestrin → `notifyInvoiceAction`. Desktopgren: redirect til `/platform/finance/payments`. |

E2e:
- MP03 → "Stop og gem" → MP04 → vælg 15 min. → Gem → tiden står på sagen og i F3 for indeværende måned.
- Supporter: Finans-fanen findes ikke, `/platform/finance*` giver 404/redirect, MP01 viser ingen tenant-data uden adgang.
- MP07: rykker kræver bekræftelse, og `finance.reminder_sent` står i platform-audit.

## 6. Test, mål og rapportering

- Playwright-projekter `mobile-390` (390 × 844, touch, iPhone-UA) og `mobile-360` (360 × 780), plus 430 × 932 for komponentsiden. Screenshot pr. tegneflade i `apps/web/e2e/__screenshots__/mobile/` og i PR'en ved siden af tegnefladen.
- axe på hver mobilskærm; 0 alvorlige fejl.
- Lighthouse: kategorien "PWA" findes ikke længere i Lighthouse 12+. Jeg kører Accessibility (mål ≥ 95), Best Practices og Performance på `/`, `/integrations` og `/platform/cases` ved 390 px og tjekker installérbarhed separat (manifest + SW, se M3). Scorerne rapporteres som de er. Se B6.
- Ingen falske grønne tilstande: et punkt, der ikke kan verificeres, står som "ikke verificeret" i PR'en.
- Nye migrationer skal virke på PostgreSQL 12 (produktion) og 16 (dev/CI).

## 7. "Send link til min computer"

Ny server action `sendDeskLink(path)`: validerer stien med `safe-next` (kun relative app-stier under kendte områder), og e-mailer brugeren selv (aldrig andre) et link via `mail.ts`. Adgangen tjekkes, når linket åbnes (samme servertjek som ellers), så e-mailen afslører intet. Rate limit 5 pr. time pr. bruger. Ingen data om ressourcen i e-mailen ud over sidetitlen. Toast "Link sendt til {e-mail}". Audit: nej, det er brugerens egen e-mail (B11).

## 8. Gaps, der skal design-tjekkes før byg (afsnit 6 i prompten + fund)

Bygges først, når du har godkendt en tegneflade, eller du siger, at jeg skal følge et forslag.

| # | Gap | Mit forslag, hvis du ikke vil tegne det |
| --- | --- | --- |
| G1 | Offline, tom og indlæsning på mobil | Komponenter-Tilstande skaleret til 390 px + `OfflineBanner` |
| G2 | Login med e-mail + kode + TOTP (mobil) | D14-Login/D14-MFA som fuldbreddekort uden app-skal; efter login tilbydes "Tilføj passkey" |
| G3 | Forbindelsesliste (status og udløb) | `RowLink` pr. forbindelse med logo, status og "udløber om N dage" |
| G4 | Betaling fejlet / kvote nået | `StatusHero` i fejl/advarsel + `DeskNote` (planskift) + "Skift kort" |
| G5 | Platform kundedetalje + anmod om supportadgang | P2 + P3 som liste og modal |
| G6 | Platform "Løs sag og send forløb" (mobil S8) | Fuldskærm med modtagere, valgfri besked og forhåndsvisning |
| G7 | Platform "Mere"-fane (profil, skift til kundens app, log ud) | **Todo (B3): tegnes senere.** Bygges ikke i M4. |
| G8 | "Ny sag" på mobil (MP02 har knappen, ingen tegneflade) | Modal med kunde, titel, prioritet, beskrivelse |
| G9 | "Sikkerhed" og "Kontakt support" i MA10 | Sikkerhed: kun "Tilføj passkey på denne telefon" + `DeskNote`; Kontakt support: `/support` som liste + svar |
| G10 | Flow-filter i MA07 ("Flow"-chippen) | Bundark eller modal med flows som radioliste |

## 9. Afvigelser mellem kilder, som jeg har afgjort

| Emne | Kilder | Afgjort sådan |
| --- | --- | --- |
| Faner | spec §8: Notifikationer som fane · beslutning 20: Mere + klokke | Beslutning 20 |
| Offline-data | prompt: cache svar · spec §8: aldrig API-svar i Cache Storage, aggregat-snapshot i IndexedDB | Spec §8 (regel) |
| Ruter i MA05 | tegnefladen viser HubSpot Handler og ingen Brevo · beslutning 12: Dinero, HubSpot, Brevo | Data fra seed; tegnefladen bestemmer kun layout |
| Bar-højder | designspec §8: top 52 / bund 64 · tegnefladerne: 60 / 76 | Tegnefladerne (layout) |

## 10. Beslutninger (19. okt. 2026)

| # | Emne | Beslutning |
| --- | --- | --- |
| B1 | Oprunding af tid | Hver registrering rundes op til nærmeste 15 min. som standard (12 min. 40 s. → 0:15, 40 min. → 0:45) og kan overskrives. Gælder både mobil (MP04) og desktop (`stopTimer`, S4). Månedsoprundingen pr. sag i Finans (beslutning 18) ændrer dermed kun noget for overskrevne værdier. |
| B2 | Offline-banner | Én tekst overalt: "Offline · data fra kl. 14:02". Produktspecifikation §8 er rettet til designspecifikationens formulering. |
| B3 | Platform "Mere" (G7) | Todo. Tegnes senere. |
| B4 | SMS | Kun push i M11. SMS-levering venter til senere. MA11's DeskNote og SMS-kolonnen i D12 forbliver uændret. |
| B5 | Web Push-bibliotek | `web-push` i worker-pakken, eksakt version fastlåst (ADR 0003). Kun på serveren. |
| B6 | Lighthouse | Køres med `pnpm dlx lighthouse@<eksakt version>`, ikke som afhængighed. Accessibility, Best Practices og Performance rapporteres pr. PR, ikke som CI-gate. Installérbarhed testes i Playwright (manifest, ikoner, SW styrer siden, `Page.getInstallabilityErrors` er tom). Tilgængeligheds-gaten er axe i Playwright. |
| B7 | Stille timer og supportadgang | Supportanmodninger sendes altid med det samme, også i stille timer. |
| B8 | Push pr. enhed | Toggles pr. enhed i `push_subscriptions.events`. `notification_prefs.push` betyder "push slået til på mindst én enhed" i D12. |
| B9 | App-ikon | Lime felt med "A" som på MA13/MA14 (192, 512 og maskable 512). |
| B10 | MA07 "Flow"-chip (G10) | Modal med flows som radioliste. |
| B11 | Send link-audit | Ikke i kundens audit-log. |
| B12 | Tenant-skift og push | Abonnement pr. tenant; push kun fra den aktive tenant, rækken er tenant-scoped under RLS. |
| B13 | Push til Platform-medarbejdere | Uden for scope i M11. |

B7–B13 er mine forslag, godkendt som udgangspunkt 19. okt. 2026 ("I'll correct anything later").

## 11. Åbne spørgsmål

Ingen lige nu.

## 12. Status for M1 (20. okt. 2026)

Bygget og verificeret lokalt, ikke committet.

- **Komponenter** i `packages/ui/src/components/mobile` (`@agentor/ui/mobile`): `Responsive`, `MobileShell`, `TopBar` (+ `BellLink`, `TopBarAction`, `TopBarAvatar`, `PlatformBadge`), `TabBar`, `StatusHero`, `RowLink`/`Row` (+ `RowIcon`, `StackedStatus`, `StackedValue`, `RowAction`), `FlowCard`, `MobileLogo`/`LogoChain`, `MobileKpi`, `Sparkline`, `TrendPill`, `MobileRing`, `WeekBars`, `SectionHeading`, `MobilePageTitle`, `DeskNote`, `MobileFootnote`, `ChipGroup`, `Switch`, `BigButton`/`BigButtonLink`, `Modal`, `ChatBubble`, `InternalNote`, `TimelineEvent`, `TimerBar`/`TimerBarAction`, og tilstandene `RowsSkeleton`, `HeroSkeleton`, `CardsSkeleton`, `KpiSkeleton`, `MobileEmpty`, `MobileError`. Nye tokens i `theme.css` (`text-m-*`, `rounded-field/bubble/3xs`, `shadow-tabbar/row-divider/modal`, safe-area- og `touch-target`-utilities) og i `cn`.
- **Skift ved 768 px** i `(app)/layout.tsx` og `platform/layout.tsx`: desktop-header og sekundær navigation skjules under 768 px, tab bar vises, og klokkens tal deles via `MobileChromeProvider`. Supportvisning viser computer-skærmen på mobil.
- **Desktop-only ruter** har fået en segment-`layout.tsx` med `DesktopOnly`: editor, nyt flow, skabeloner, afstemning, Indstillinger (virksomhed, team, sikkerhed, audit-log, profil), Platform tid, platformbrugere, platformindstillinger, systemstatus, Finans-undersider, kundedetalje (G5), løs sag (G6) og arkiv.
- **`sendDeskLink`** (`app/actions/desk-link.ts`) med unit test af stivalideringen.
- **`/dev/mobile`** viser alle komponenter i alle tilstande.
- **Tests:** `e2e/mobile-shell.spec.ts` i projekterne `mobile-390`, `mobile-360` og `mobile-430`: ingen vandret scroll, axe uden fund, alle kontroller ≥ 44 × 44, mål mod tegnefladerne (60/76/52/56, pill 52 × 30, SectionHeading), modal (centreret, radius 20, fokusfælde, Esc, baggrund, fokus tilbage), skift ved 767/768 uden fokus i den skjulte gren, "Send link til min computer" med mail i Mailpit, Finans kun for Superadmin (403 for Supporter). Desktop-specs (komponenter, team, platform) er uændret grønne. Screenshots i `docs/screenshots/mobile/`.

Afvigelser fra tegnefladerne, som du bør kende:

1. **Kontrast:** grøn tekst på grøn baggrund (`ok-fg` på `ok-bg`, 4,4:1) og orange tekst på den gule note (`warn-fg` på `note-bg`, 4,1:1) klarer ikke 4,5:1 ved 11–11,5 px. `TrendPill` har derfor mørk tekst med en grøn pil, og "Intern note"-linjen er mørk med en orange lås. Desktop-`GrowthBadge` har samme problem (opfølgning).
2. **Trykflader:** chips (32), switches (26) og små knapper (28) tegnes som på tegnefladerne, men trykfladen er udvidet til 44 × 44.
3. **Tom, indlæser og fejl** følger Komponenter-Tilstande skaleret til 390 px (G1), indtil der er en tegneflade.
4. Platform-avataren er ikke klikbar, indtil "Mere" (G7) er tegnet.

Ikke gjort i M1: ingen af skærmene MA01–MA15 og MP01–MP07 (M2/M4), Lighthouse (kører når der er rigtige skærme), og `playwright.config.ts` har fået `E2E_SKIP_SEED=1` til lokale kørsler mens en anden dev-server bruger databasen.
