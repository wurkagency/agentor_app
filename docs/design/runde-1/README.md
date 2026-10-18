# Agentor App — Design, runde 1

Eksport af designlærredet **"Agentor App — Runde 1"** (Claude Design), version 1792357173-1860, 18. okt. 2026.
Live-lærred (privat, kræver adgang): https://claude.ai/artifact/PM26ZBLDG84UP6EMwvRw1a

## Indhold

| Mappe / fil | Hvad |
| --- | --- |
| `boards/*.dc.html` | Én fil pr. tegneflade. Statisk HTML med inline-styles. Åbn direkte i en browser (ukendte tags som `<x-dc>` og `<helmet>` ignoreres, og styles virker). |
| `canvas.json` | Lærredets indeks: titel, størrelse og placering pr. tegneflade. |
| `logos/*.svg` | Rensede connector-logoer (ingen `<style>`, scripts eller indlejrede billeder). |

Tegnefladerne henter logoer fra lærredets asset-lager (`/_blob/<id>`). Lokalt peger de URL'er ingen steder hen. Brug tabellen nederst til at mappe til `logos/`.

## Tegneflader

### Fundament
| Fil | Indhold |
| --- | --- |
| `Main.dc.html` | 1.0 Tokens: farver inkl. status og kontrast, typografi, afstande, radier, skygger, ikoner, fokus, bevægelse |
| `Komponenter-Handlinger.dc.html` | 1.1 Button, StatusPill, ModeBadge, ConnectorLogo/Pair, StatCard, FilterChip, Tabs, Switch/Checkbox/Radio, UsageMeter, Tooltip, Avatar |
| `Komponenter-Data.dc.html` | 1.2 DataTable (udfoldelig og valgbar), Input/Select/Combobox, Accordion "Avanceret", KeyValueList |
| `Komponenter-Feedback.dc.html` | 1.3 Dialoger (standard, destruktiv, Gå Live), Toast, Banner. **Bemærk:** Gå Live-dialogen her er ældre. `D5-GaaLive` er gældende (har valget "Som kladde"). |
| `Komponenter-Tilstande.dc.html` | 1.4 EmptyState, Skeleton, ErrorCard, de fire tilstande (indhold/indlæser/tom/fejl) |
| `App-skal.dc.html` | 1.5 Forkastet variant med navy sidebar. **Bruges ikke.** |
| `App-skal-B.dc.html` | 1.5b **Valgt app-skal**: topnavigation, sekundær pill-navigation, profilmenu åben |
| `App-skal-B-Indstillinger.dc.html` | 1.5b med Indstillinger valgt (indstillingssider i sekundær navigation) |

### Skærme
| Fil | Skærm · tilstand |
| --- | --- |
| `D1-Overblik.dc.html` | D1 Overblik · alt kører |
| `D1-Overblik-Problemer.dc.html` | D1 Overblik · problemer (2 fejl + 1 afbrudt) |
| `D1-Ny-kunde.dc.html` | D1 Overblik · ny kunde med tjekliste |
| `D1-Soeg.dc.html` | ⌘K søg eller hop til |
| `D2-Integrationer.dc.html` | D2 Integrationer · flow udfoldet (5 ruter) |
| `D2-Integrationer-Samlet.dc.html` | D2 · alle flows samlet (prototype) |
| `D2-Valg.dc.html` | D2 · masseredigering |
| `D2-Tom.dc.html` | D2 · tom med skabelonkort |
| `D2-Graense.dc.html` | D2 · planens grænse nået |
| `D2-Notifikationer.dc.html` | Notifikationspanel (popover fra klokken) |
| `D3-Editor.dc.html` | D3 Editor · rute valgt, Mapping |
| `D3-Editor-Start.dc.html` | D3 · intet valgt (flowindstillinger og klartekst) |
| `D3-Editor-Traek.dc.html` | D3 · under træk (gyldig port lime, ugyldige nedtonet) |
| `D3-Editor-Validering.dc.html` | D3 · valideringsfejl, bundpanel åbent |
| `D3-Editor-Skjult.dc.html` | D3 · inspektør skjult |
| `D3-Editor-Laest.dc.html` | D3 · skrivebeskyttet (anden bruger redigerer) |
| `D4-Skabelonvaelger.dc.html` | D4 Nyt flow · skabelonvælger |
| `D4-Guide.dc.html` | D4 Editor med guide (2 af 4) |
| `D5-Testkoersel.dc.html` | D5 Testkørsel i bundpanelet |
| `D5-GaaLive.dc.html` | D5 Publicér-dialog med valget kladde/Live |
| `D6-Listevisning.dc.html` | D6 Editor · listevisning, Generelt-fanen |
| `D7-Flow-Oversigt.dc.html` / `D7-Flow-Fejl.dc.html` | D7 Flowdetalje · standard / med fejl |
| `D8-Koersler-Forretning.dc.html` / `D8-Koersler-Udvikler.dc.html` | D8 Kørsler · fejlet record, forretnings- og udviklervisning |
| `D9-Forbindelser.dc.html` / `D9-Dinero-Afbrudt.dc.html` / `D9-Katalog.dc.html` | D9 Forbindelser · liste / afbrudt detalje / tilføj-katalog |
| `D10-Aktivitet-Log.dc.html` / `D10-Afstemning.dc.html` | D10 Aktivitet · log / afstemning |
| `D11-Team.dc.html` / `D11-Inviter.dc.html` | D11 Team og adgang / invitér |
| `D12-Notifikationer.dc.html` / `D12-Sikkerhed.dc.html` / `D12-Auditlog.dc.html` | D12 Indstillinger |
| `D13-Abonnement.dc.html` | D13 Abonnement og forbrug |
| `D14-Login.dc.html`, `D14-MFA.dc.html`, `D14-Onboarding-1..3.dc.html` | D14 Login, MFA, onboarding i 3 trin |
| `M1`–`M7` | Mobil: Overblik, Integrationer, Fejldetalje, Notifikationer, Editor (kræver computer), installation, push-eksempler |

## Beslutninger truffet under designet (afviger fra specifikationerne)

Disse vinder over Designspecifikation v1 og Produktspecifikation v1.x, hvor de er i konflikt:

1. **App-skal uden sidebar** (1.5b): topbjælke 88 px med logo, primær navigation som tekstlinks med 2 px mørk understregning (Overblik, Integrationer, Forbindelser, Aktivitet), og til højre ⌘K, klokke og konto-chip. Under den en sekundær navigation som pills (fx Flows · Kørsler · Skabeloner). Indhold maks. 1200 px, centreret på samme akse som headeren. Editoren bruger en kompakt header på 64 px.
2. **"Udvikler" er ikke et menupunkt.** Integrationssider har i stedet en segmenteret kontrol **Basic | Developer** i sidehovedet. Developer viser felt-til-felt-mapping med udtryk, request/response, webhooks og API-nøgler.
3. **Indstillinger og Abonnement ligger i profilmenuen** (Skift virksomhed, Min profil, Indstillinger, Abonnement og forbrug, Sprog, Log ud). Indstillingssiderne vises som sekundær navigation: Virksomhed, Team og adgang, Notifikationer, Sikkerhed, Audit-log.
4. **Hjælp-ikonet er fjernet** fra topbjælken. "Kræver handling" vises som tal i klokkens badge (rødt ved fejl eller afbrudt, ellers mørkt), ikke som separat pill.
5. **Logo:** ordmærket "Agent" + "or" med 2 px understregning under "or", 24/700, −0.02em. Ingen trekant (som agentor.dk).
6. **Canvas er lysere:** ny token `--app-canvas: #F7F5F1` som sidebaggrund. `#F0EDE8` (`--color-bg-base`) bruges kun som fyld inde i hvide flader (skeleton, hover, chips).
7. **Alle tabeloverskrifter er mørke** (`#1A1A18`, 12/600), ikke fg-2.
8. **Mapping i inspektøren:** felter står i én kolonne med label til venstre og input til højre (ikke to kolonner). Sektioner (Konti, Kategori → konto, Fakturaindstillinger) kan foldes ud og sammen med en chevron.
9. **"Kategori → konto" har ingen Moms-kolonne.** Moms styres af kontoen i ERP-systemet. Konto er en dropdown med data fra destinationen. Kategorier kommer fra kilden og kan ikke omdøbes.
10. **Inspektøren kan skjules** med en ikonknap i dens header (genvej `]`). Den skjulte tilstand er en 48 px kant, der åbner den igen.
11. **Publicér-dialogen** har valget "Sådan oprettes fakturaer i Dinero": **Som kladde, uden bogføring** (standard) eller **Bogfør med det samme (Live)**. Afkrydsningen og knappens tekst følger valget.
12. **D2 viser 5 ruter** for flowet "Webshop → regnskab og CRM", så det stemmer med editoren (Kunder → Dinero, HubSpot og Brevo).
13. **Fokusflows** (login, MFA, onboarding) er centrerede kort på canvas uden app-skal.
14. Connector-katalog (`D9-Katalog`) viser 23 systemer i 5 grupper med tilstandene Forbundet, Tilgængelig og På vej.

## Kendte pladsholdere

- Antal transaktioner og integrationssæt for **Startup** og **Enterprise** står som `[ANTAL]` (D13, D2-Graense, onboarding 2). De skal komme fra `plan_entitlements`.
- Business Central har ikke et brugbart logo (filen indeholder et PNG). Brug initialer "BC" som fallback.

## Logo-mapping (`/_blob/<id>` → `logos/`)

| Blob-id | Fil |
| --- | --- |
| 2a2f4ae979d76b93057878040a3dc65b | woocommerce.svg |
| c4fa7e9713426e6bf824b492bdc0f2b5 | shopify.svg |
| b0fc7b3ea30379ba1f4587aa5ab39988 | dinero.svg |
| 95b70a4a13463e5882c443af894d72f1 | economic.svg |
| ec1a12de2e94178cbd6b6944d9a1ba2e | hubspot.svg |
| 672c5f0550758ab066fe4bb96295ca47 | brevo.svg |
| 88fdc257d47087225f8103d62948ae99 | mailchimp.svg |
| a6fcc57f7d1c01d2c0fbfb8b6a0a75b3 | activecampaign.svg |
| 9131f8f381a04e7d0afaef2a327426c3 | adobe.svg |
| 361d864155326821e2980fd1b5c1797f | billy.svg |
| d2b3ab4c42815b2e839141a3a864d45b | campaignmonitor.svg |
| 043c3e0879a6e6c58ef5369dfaaec436 | dandomain-classic.svg |
| e4912bc8c448f572534c4829e2e8b73c | dandomain.svg |
| 30e9119eef3d4c5bbd5a5d9fb8e94cec | fortnox.svg |
| 1a166f925cf250084c9b2ecfe52c2cfb | kit.svg |
| 9595fea964bd58e09c6f3046444df15f | klaviyo.svg |
| 3d6eaea29bf090b20b5f81e73faf0432 | magento.svg |
| bb96ab946df952c85dcfd76054cb557e | pipedrive.svg |
| b11db780825c2d2e585b1fb2d768393d | prestashop.svg |
| 01cc60e133d40d9a75d28da7bfabadf6 | salesforce.svg |
| ef9468430ba0c36fa370f5a9a2d26772 | sendgrid.svg |
| 857b441eb55c8cd7ad62689b8d6c60fd | twilio.svg |
