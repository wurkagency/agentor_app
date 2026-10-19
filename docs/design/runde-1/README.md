# Agentor App — Design, runde 1

> **Status 19. okt. 2026: klar til Claude Code.** Denne mappe er en eksakt kopi af canvas (83 tegneflader, version 1792428068). Videre opdateringer sker i koden. Ændres designet igen på canvas, eksporteres det på ny hertil.

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

### Agentor Platform (interne roller)
| Fil | Indhold |
| --- | --- |
| `P1-Kunder.dc.html` | Kundeliste for Supporter: plan, samlet status, fejl i dag, supportadgang og handling (Åbn som support / Anmod om adgang) |
| `P1-Kunder-Menu.dc.html` | Tandhjulsmenuen åben: Kunder, Supportsager, Systemstatus. Platformbrugere og Platformindstillinger er låst til Superadmin |
| `P2-Kunde.dc.html` | Kundedetalje med aktiv adgang (nedtælling, bed om forlængelse, afslut), kundeinfo, kundens "Kræver handling", supportsag med intern note, adgangslog |
| `P3-Adgang.dc.html` | Anmod om supportadgang: sag, begrundelse, varighed (1, 8 eller 24 timer), omfang (Kun se / Se og hjælpe) |
| `P4-Supportvisning.dc.html` | Kundens app med navy supportbjælke: kunde-skifter (⌘J), sag, godkender, nedtælling, "Afslut supportvisning" |
| `P5-Skift-Kunde.dc.html` | Kunde-skifteren åben: aktive adgange, seneste kunder, søgning |
| `P6-Platformbrugere.dc.html` | Superadmin: medarbejdere, roller, rettighedsmatrix, regler for supportadgang |

### Supportoverblik (Platform)
| Fil | Indhold |
| --- | --- |
| `S1-Sager-Tavle.dc.html` | Sager som tavle (Ny · I gang · Venter på kunde · Løst) med nøgletal, filtre og kort med prioritet, svarfrist, fejl, noter, tid og ansvarlig |
| `S2-Sager-Arkiv.dc.html` | Arkiv og listevisning: søgning i titel, løsning og noter, tid pr. sag, eksport |
| `S3-Sag.dc.html` | Sagsdetalje: status, prioritet, tildelt, kategori, frist, følgere, tidslinje (kundebeskeder, svar, interne noter, auto-loggede sessioner), komponist med "Intern note", tid på sagen, kunde med fastgjort kundenote, tidligere sager |
| `S4-Tid-Tilfoej.dc.html` | Manuel tid: varighed med hurtigvalg, dato, type (telefon, e-mail, afklaring), beskrivelse, fakturerbar |
| `S5-Session-Slut.dc.html` | Når supportvisningen afsluttes: auto-logget tid, handlinger i sessionen, knyt til sag, ret tid, opsummering som intern note |
| `S6-Min-Tid.dc.html` | Ugeoversigt over tid pr. sag og dag, igangværende session, sessioner uden sag |
| `S7-Fejl.dc.html` | Fejl på tværs af kunder grupperet efter fejlkode, med antal kunder, udvikling og sag |
| `S8-Sag-Loes.dc.html` | Løs sag og send forløbet til kunden på e-mail: modtagere, hvad der kommer med, interne noter udelades altid, valgfri afsluttende besked, forhåndsvisning |

### Finans (Platform, kun Superadmin)

| Fil | Indhold |
|---|---|
| `F1-Finans-Oversigt.dc.html` | Abonnementsomsætning pr. måned, aktive abonnementer, support i måneden, forfaldent, omsætning pr. måned (abonnement og support), punkter der kræver handling, fornyelser |
| `F1-Finans-Oversigt-Dage.dc.html` | Samme oversigt med omsætning pr. dag i den valgte måned (skift mellem Dage og Måneder) |
| `F2-Abonnementer.dc.html` | Alle abonnementer: plan, månedlig eller årlig, pris, periode, næste opkrævning, betalingsmetode og status |
| `F3-Support-Afregning.dc.html` | Indeværende måneds support pr. kunde og sag: registreret tid, oprundet tid og beløb, åben periode |
| `F4-Kunde-Oekonomi.dc.html` | Én kundes abonnement, løbende support, support pr. måned og fakturaer med betalingsstatus |
| `F5-Supportfaktura.dc.html` | Kladde til supportfaktura med linjer pr. sag, moms og afsendelse via QuickPay |
| `F6-Betalinger.dc.html` | Fakturaer og betalinger på tværs: forfaldne, rykkere, fejlede kortbetalinger, seneste betalinger |
| `F7-Rapporter.dc.html` | Månedsrapport: økonomiske nøgletal og supportomfang, største kunder, tid pr. supporter, tidligere måneder |

### Mobile (siden "Mobile" på tegnefladen · 390 × 844)

| Fil | Indhold |
|---|---|
| `MA01-Log-ind.dc.html` | log ind |
| `MA02-Overblik.dc.html` | overblik, alt kører |
| `MA03-Overblik-Problemer.dc.html` | overblik, problemer |
| `MA04-Integrationer.dc.html` | integrationer |
| `MA05-Flow.dc.html` | flow |
| `MA06-Fejl.dc.html` | fejl |
| `MA07-Aktivitet.dc.html` | aktivitet |
| `MA08-Genforbind.dc.html` | genforbind |
| `MA09-Notifikationer.dc.html` | notifikationer |
| `MA10-Mere.dc.html` | mere |
| `MA11-Notifikationsindstillinger.dc.html` | notifikationsindstillinger |
| `MA12-Supportadgang.dc.html` | godkend supportadgang |
| `MA13-Installer.dc.html` | føj til hjemmeskærm |
| `MA14-Push.dc.html` | push-beskeder |
| `MA15-Abonnement.dc.html` | abonnement |
| `MP01-Kunder.dc.html` | kunder |
| `MP02-Sager.dc.html` | sager |
| `MP03-Sag.dc.html` | sag |
| `MP04-Tid.dc.html` | registrér tid |
| `MP05-Fejl.dc.html` | fejl på tværs |
| `MP06-Finans.dc.html` | finans |
| `MP07-Forfaldne.dc.html` | forfaldne |

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
15. **Fluid layout** (se `Layout.dc.html` og de tre `*-2560.dc.html`): alle app-sider fylder vinduet (`width: 100%; min-height: 100vh`). Sidemargen er `clamp(24px, 3vw, 64px)`, og indholdet har en anbefalet maksbredde på **1920 px**, centreret på samme akse som header og sekundær navigation. Formularkort er højst 960 px. Editoren fylder altid hele vinduet (`100vw × 100vh`, minimum 1280 × 720): palet 240 px og inspektør 440 px er faste, lærredet vokser, og noderne centreres. Brudpunkter: < 768 (mobil), 768–1279 (tablet, editor i listevisning), 1280–1919 (desktop), ≥ 1920 (bred). Tegnefladerne er vist ved 1440 px. Rækken "Fluid layout" viser de samme skærme ved 2560 px.

16. **Agentor Platform i app'en** (afviger fra produktspecifikationen, der placerer support i manage.agentor.dk): Agentor-medarbejdere med rollen **Superadmin** eller **Supporter** får et tandhjul i topbjælken. Det åbner Platform-området med egen header (Platform-mærke og navigation: Kunder, Supportsager, Systemstatus, Platformbrugere). Reglerne fra produktspecifikation §9.7 gælder uændret: ingen stående adgang, adgang pr. sag med begrundelse i højst 24 timer (afviger fra produktspecifikationens 60 minutter), kundens godkendelse når kunden kræver det (D8), aldrig nøgler, team eller abonnement, og hver handling i kundens audit-log med medarbejderens navn. Under adgang vises kundens egen app med en navy supportbjælke, der ikke kan skjules, og kunden kan skiftes med ⌘J. Superadmin har heller ingen stående adgang til kundedata.

17. **Supportoverblik** (ny funktion, ikke i produktspecifikationen): Platform-navigationen har nu Kunder, Supportsager, Fejl, Tid, Systemstatus og Platformbrugere. Sager har statusserne Ny, I gang, Venter på kunde og Løst (arkiveres efter 14 dage) og prioriteterne Kritisk, Høj, Normal og Lav. Prioritet bruger ikke statusfarver. Tid logges automatisk pr. supportsession (fra første til sidste handling, pauser over 10 min. trækkes fra) og bekræftes, når sessionen afsluttes. Manuel tid og timer findes også. Interne noter er gule (#FBF0DC), markeret "Intern note" og aldrig synlige for kunden. Kundenoter kan fastgøres på kunden. "Fejl på tværs" viser kun antal og fejlkoder, aldrig kundedata. Fakturerbar tid kan markeres for alle kunder, og kundens abonnement vises ved feltet. Svarfrister er en pladsholder, til der er besluttet en supportaftale.
18. **Finans** (ny funktion): Abonnementer og betalt support afregnes gennem Agentor Platform under fanen Finans, som kun Superadmin ser. Abonnementer opkræves forud, månedligt eller årligt, med kort eller MobilePay via QuickPay. Enterprise kan betale på faktura med EAN. Årlig pris er antaget at være 10 gange månedsprisen. Support faktureres bagud den 1. i næste måned til 800 kr. pr. time inkl. moms (640 kr. ekskl.). Tiden oprundes til nærmeste 15 min. pr. sag pr. måned. Tid uden sag og tid markeret som ikke fakturerbar kommer ikke med. Satsen kan ændres af Superadmin. Rapporter viser beløb ekskl. moms, mens fakturaer og supportafregning viser beløb inkl. moms. Mislykkede kortbetalinger forsøges igen efter 2, 5 og 9 dage.
19. **Dashboard-blokke** (gælder alle Platform-oversigter: Kunder, Supportsager, Tid, Fejl og alle Finans-sider): Hver side starter med en række nøgletalskort. Det første kort er fremhævet (lime gradient, stort tal, vækstmærke og en kurve over tidligere perioder). De øvrige kort har ét visuelt element: en segmenteret søjle med streg-ticks i enden, en halvcirkel-måler med lime prik eller små søjler for de sidste 6 perioder, hvor den aktuelle periode er skraveret. Vækstmærker viser ↑/↓ mod forrige periode, grønt når ændringen er god, rødt når den er dårlig, gråt når den er neutral. Omsætningsgrafen kan skifte mellem Dage og Måneder: måneder som stablede, afrundede søjler (sort abonnement, skraveret lime support) med tooltip, dage som tynde søjler med en linje for samlet omsætning og en stiplet prognose. Eksempeltallene for tidligere perioder er pladsholdere. Kortene findes i to størrelser: stor (Finans) og kompakt, ca. 120 px høj (Kunder, Supportsager, Tid og Fejl), hvor grafikken står til højre for tallet og detaljerne er samlet på én linje.
20. **Mobil og PWA** (siden "Mobile", erstatter de tidligere M1–M7, som er fjernet): Mobilen er til at følge med og handle hurtigt, ikke til at bygge. Ingen node-editor, ingen KPI-dæk og ingen tabeller. Kundens app har fire faner (Overblik, Integrationer, Aktivitet, Mere) og klokken øverst. Integrationer vises som statuskort med logoer, ruter som en liste. Det man kan på mobilen: se status og fejl med forklaring, gentage fejlede records, pause og genoptage flows, genforbinde en afbrudt forbindelse (OAuth), godkende eller afvise supportadgang, styre push og se abonnement og fakturaer. Mapping, regler, nye flows, plan og team ændres på computer, og skærmene siger det med en grå "computer"-linje og "Send link til min computer". Platform på mobil (navy header) har fanerne Kunder, Sager, Fejl og Finans (kun Superadmin): sager som liste i stedet for tavle, svar og interne noter, timer med "Stop og gem" og registrering af tid i en modal oven på sagen, fejlkoder på tværs og finans som én liste med nøgletal og forfaldne betalinger med rykker. Supportvisning af kundens app sker på computer. Login med passkey (WebAuthn), som telefonen låser op med Face ID, Touch ID eller fingeraftryk. E-mail og kode som alternativ. Push siger altid hvad der skete, åbner det rigtige sted og kan samles i stille timer (`MA14`). Under 768 px bruges disse skærme.

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
