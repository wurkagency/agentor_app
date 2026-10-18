# Agentor App — Designspecifikation v1

Oct 18, 2026 · @Charlie Nielsen

Dokumentet fastlægger, hvordan app.agentor.dk skal se ud og opføre sig i designrunde 1. Det er bindende for Claude Design og for den senere implementering i Next.js, Tailwind og shadcn/ui. Startprompten nederst (afsnit 11) kan kopieres direkte ind i Claude Design.

## 0. Grundlag

| Kilde | Hvad den bestemmer |
| --- | --- |
| *Agentor App — Produkt- og løsningsspecifikation v1.1* (godkendt 18. okt. 2026) | Funktioner, sider, roller, statusmodel, flow-editorens adfærd |
| *Design System – Agentor Web* (BRAND-CONTINUITY.md, DESIGN-RULES.md, tokens/) | Brandet: farver, typografi, radier, skygger, ikoner, tone |
| Godkendte app-undtagelser (D5) | Lys canvas bag arbejdsflader, statusfarver, sentence case på tætte knapper, borders i tabeller og inputs, app-typeskala, app-skal med sidebar |

**Regel ved tvivl:** Først gælder denne designspecifikation, derefter brandets regler, derefter produktspecifikationen. Hvis noget ikke er beskrevet, skal det nærmeste eksisterende mønster genbruges. Der må ikke opfindes et nyt.

**Ikke i runde 1:** dark mode (tokens skal dog være klar til det), white-label, tablet-specifikke layouts ud over listevisningen af editoren og marketingsider.

## 1. Designprincipper

App'en er et roligt, præcist driftsværktøj med Agentors brand. Lime bruges til handling og fremhævning, ikke som baggrund overalt. Det meste af fladen er hvid, varm grå og mørk tekst.

1. **Svar på 3 sekunder.** Hver side åbner med status og tal i toppen. Brugeren skal kunne se "kører alt?" uden at scrolle på 1440 × 900.
2. **Én primær handling pr. visning.** Den er lime. Alt andet er sekundært (hvid med ring) eller ghost.
3. **Progressiv dybde.** Standardvisningen er til forretningsejeren. "Avanceret" ligger på samme side, foldet ind, og dens tilstand huskes pr. bruger.
4. **Status er tekst + ikon + farve.** Farven alene betyder aldrig noget.
5. **Sikkert som standard.** Destruktive og "Gå Live"-handlinger kræver bekræftelse. Nye ruter starter i Test.
6. **Fejl forklarer sig selv.** Hvad skete der, hvorfor, og hvad gør jeg nu, i dansk hverdagssprog. Tekniske detaljer kan foldes ud.
7. **Tæthed med luft.** Tabeller er kompakte (række 44 px), men sektioner får luft (32–48 px). Det bevarer brandets ro.
8. **Generisk frem for specifik.** Formularer, porte og mappingfelter tegnes som generiske komponenter, der fyldes af connector-manifestet. Der designes ikke særløsninger til Dinero eller HubSpot.

## 2. Fundament (tokens)

Alle værdier er tokens. Ingen komponent må bruge hex, px-værdier uden for skalaen eller egne skygger. Navnene følger webdesignsystemet. Nye app-tokens har præfikset `--app-` eller `--status-`.

### 2.1 Farver: brand (uændret fra web)

| Token | Værdi | Brug i app |
| --- | --- | --- |
| `--color-primary` | #D0E84A | Primær knap, valgt navigationspunkt (indikator), valgt rute i editoren, fokus i forbindelse med mørk ring, progress-fyld |
| `--color-primary-bright` | #DCEE55 | Hover på lime-flader, fremhævet stat-kort |
| `--color-dark` / `--color-fg-1` | #1A1A18 | Overskrifter og brødtekst, tekst på lime, fokusring |
| `--color-fg-2` | #6B6B67 | Sekundær tekst, labels, inaktive faner |
| `--color-fg-3` | #9B9B97 | Metadata, placeholder. Kun på hvid og ≥ 13 px. |
| `--color-secondary-navy` | #13293A | Live-mærke, sidebar-baggrund (se 3.2), mørke bannere |
| `--color-border` | #E4E1DB | Tabel- og inputlinjer, skillelinjer |
| `--color-border-strong` | #C8C5BF | Sekundær knap-ring, hover på inputs |
| `--color-bg-base` | #F0EDE8 | **App-canvas** bag hvide arbejdsflader (godkendt undtagelse) |
| `--app-surface` | #FFFFFF | Kort, tabeller, paneler, inspektør |
| `--app-canvas-dots` | #DCD8D1 | Prikgrid på editorens lærred (1 px prik, 16 px afstand) |

### 2.2 Farver: status (nye, godkendt som undtagelse)

Statusfarver bruges kun til status: pills, prikker, kantmarkører, bannere. Tekst i pills er altid `--color-fg-1`. Ikonet bærer farven.

| Status | Ikon (Lucide) | `--status-*-fg` (ikon/linje) | `--status-*-bg` (pill/banner) |
| --- | --- | --- | --- |
| Aktiv (`ok`) | `circle-check` | #2F7D4F | #E6F2EA |
| Advarsel (`warn`) | `triangle-alert` | #A86412 | #FBF0DC |
| Fejl (`error`) | `circle-x` | #B42318 | #FBE7E4 |
| Afbrudt (`broken`) | `unplug` | #B42318 | #FBE7E4 |
| Pauset (`paused`) | `circle-pause` | #6B6B67 | #EFEDE8 |
| Info / Test (`info`) | `flask-conical` | #2B5C8A | #E5EDF5 |
| Kladde (`draft`) | `pencil-line` | #6B6B67 | transparent med stiplet `--color-border-strong` |

Kontrast: alle `-fg`-farver har mindst 3:1 mod deres `-bg` (ikoner) og mindst 4,5:1 mod hvid (tekst, hvis de bruges til tekst i bannere). Det skal verificeres i Claude Design.

### 2.3 Kørselstilstand

| Tilstand | Udseende |
| --- | --- |
| **Live** | Navy pill, hvid tekst "Live", ikon `radio` |
| **Kladde** (draft-posting) | Hvid pill, `--color-border-strong`-ring, tekst "Kladde", ikon `file-pen` |
| **Test** (dry-run) | `--status-info-bg`, tekst "Test", ikon `flask-conical` |

### 2.4 Typografi (app-skala, godkendt)

Font: Plus Jakarta Sans. Tal i tabeller bruger `font-variant-numeric: tabular-nums`. Kode og id'er bruger JetBrains Mono 12.5/400. Monospace er en ny tilføjelse, kun til id'er, JSON og udtryk.

| Rolle | Størrelse / vægt / linjehøjde | Tracking | Brug |
| --- | --- | --- | --- |
| Sidetitel | 28 / 600 / 1.2 | −0.01em | Én pr. side |
| Sektion | 20 / 600 / 1.3 | −0.01em | Kortgrupper, faner på detaljesider |
| Korttitel | 16 / 600 / 1.4 | 0 | Kort, inspektør-sektioner, dialoger |
| Brødtekst | 14 / 400 / 1.55 | 0 | Standard |
| Tabel | 13 / 400 / 1.4 (header 12 / 600, fg-2) | 0 | Tabeller, lister |
| Metadata | 12 / 500 / 1.4 | 0 | Tidsstempler, hjælpetekst |
| Eyebrow | 12 / 600 / UPPERCASE | +0.08em | Grupper i sidebar og palet |
| Stat-tal (Overblik) | 40 / 700 / 1 | −0.03em | Kun nøgletalskort |
| Stat-tal (kompakt) | 24 / 700 / 1 | −0.02em | Kort på detaljesider, mobil |
| Primær knap | 12 / 700 / UPPERCASE | +0.10em | Brandets CTA |
| Tæt knap | 13 / 600 / sentence case | 0 | Tabeller, inspektør, værktøjslinjer |

### 2.5 Afstande, radier, skygger

- **Afstandsskala (4 px-grid):** 4, 8, 12, 16, 24, 32, 40, 48. Sektionsafstand på sider er 32. Mellem sidetitel og indhold 24. Kortpadding 24 (kompakt 16).
- **Radier:** 8 (inputs i tabeller, chips i tabeller, tooltips), 12 (noder i editoren), 16 (kort, paneler, dialoger), 20 (fremhævede lime-paneler), fuld (knapper, pills, avatarer, søgefelt).
- **Skygger:** `--shadow-sm` (kort på canvas, noder), `--shadow-card` (dialoger, popovers, flydende inspektør på mindre skærme). Kort med skygge har ingen border. Tabeller ligger i et kort uden border og bruger kun interne linjer.

### 2.6 Ikoner og bevægelse

- Kun Lucide 0.460, stroke 1.75. Størrelser 16 (tabeller, pills), 18 (knapper, navigation) og 24 (tomme tilstande, mobil-bundbar). Ingen emoji.
- Connector-logoer er den eneste farvede grafik. De vises i en 32 × 32 hvid firkant med radius 8 og `--color-border`.
- Bevægelse: 150–250 ms `ease`. Udfoldning af rækker 200 ms. Under en aktiv kørsel bevæger en prik sig langs ruten i editoren (1.4 s loop), og en roterende `refresh-cw` vises ved "Kører". Alt slås fra ved `prefers-reduced-motion`.

## 3. Layout og app-skal

Alle desktop-skærme designes på **1440 × 900**. De skal også virke på 1280 × 800, som er editorens minimum. Mobil designes på **390 × 844**.

### 3.1 Breakpoints

| Bredde | Opførsel |
| --- | --- |
| ≥ 1440 | Grundlayout. Sidebar 240 px udfoldet. Indhold maks. 1200 px bredt (undtagen editor og tabeller, som bruger fuld bredde). |
| 1280–1439 | Sidebar 240 px. Indholdet fylder bredden med 32 px padding. Inspektøren i editoren er 400 px. |
| 1024–1279 | Sidebar foldes til 64 px (ikoner med tooltip). Editoren viser listevisningen som standard med knappen "Vis lærred". |
| 768–1023 | Tablet: som 1024, men inspektøren bliver et flydende panel over indholdet. |
| < 768 | Mobil/PWA: bundnavigation, én kolonne, begrænset funktionalitet (afsnit 8) |

### 3.2 App-skal (desktop)

| Zone | Mål | Indhold og stil |
| --- | --- | --- |
| **Sidebar** | 240 px (64 px foldet), fuld højde | Navy `--color-secondary-navy`. Øverst logo (hvid trekant og ordmærke, 24 px) og tenant-vælger (virksomhedsnavn + chevron; skjules ved én tenant). Navigation: Overblik, Integrationer, Forbindelser, Aktivitet, Udvikler. Under en eyebrow "KONTO": Indstillinger, Abonnement. Nederst: forbrugsmåler (transaktioner, lime fyld på navy spor) og "Fold ind". Punkter er 40 px høje med 18 px ikon og tekst 14/500 i hvid 78 %. Hover giver hvid 8 %-baggrund. **Aktiv** er en lime pill med mørk tekst. |
| **Topbjælke** | 56 px, ligger på canvas | Venstre: brødkrumme (fx "Integrationer / Webshop → regnskab"). Midt: søgefelt (pill, 360 px, "Søg eller hop til… ⌘K"). Højre: hjælp-ikon, notifikationsklokke med tæller, avatar med menu (profil, sprog, log ud). |
| **Indholdsområde** | Canvas `--color-bg-base`, padding 32 | Sidehoved: sidetitel 28/600, undertekst 14 fg-2, højre side med primær og sekundær handling. Derefter kort og tabeller på hvide flader. |
| **Inspektør** (editor og detaljepaneler) | 440 px (400 ved < 1440) | Hvid, venstre kant 1 px `--color-border`, sticky header og sticky footer med Gem/Annullér |
| **Globale bannere** | Fuld bredde over indholdet, 48 px | Betaling fejlet, kvote over 100 %, vedligehold. Bruger status-bg og kan lukkes, når det er sikkert. |

### 3.3 Sidetyper

1. **Oversigtsside** (Overblik): grid med 12 kolonner og 24 px gutter, kort i 3- eller 4-kolonners rækker.
2. **Listeside** (Integrationer, Forbindelser, Aktivitet): sidehoved, værktøjslinje (søg, filterchips, visning) og tabel i fuld bredde.
3. **Detaljeside** (Flowdetalje, Forbindelse): sidehoved med statuspill og handlinger, fanebjælke (understreget aktiv fane, 2 px mørk), indhold i kort.
4. **Arbejdsflade** (Editor): fuld skærm inden for app-skallen. Sidebaren foldes automatisk til 64 px for at give plads.
5. **Indstillingsside**: venstre undermenu 200 px og formularkort maks. 720 px bredt.
6. **Fokusflow** (Login, Onboarding): ingen sidebar. Centreret kort 480 px på canvas med logo over.

## 4. Komponentbibliotek

Hver komponent designes med tilstandene **standard, hover, fokus (2 px mørk ring, 2 px afstand), aktiv/valgt, deaktiveret og indlæser**, hvor de giver mening. Navnene matcher shadcn/ui, så implementeringen kan følge dem direkte.

| Komponent | Varianter | Specifikation |
| --- | --- | --- |
| **Button** | primary (lime), secondary (hvid + 1.5 px ring), ghost, dark (navy), destructive (hvid, rød tekst og ring) | Pill. Størrelser: L 48 px (12/700 UPPERCASE, kun primære CTA'er på sideniveau), M 36 px (13/600 sentence case), S 28 px (12/600). Ikon 16–18 px med 8 px afstand. Kun-ikon-knap 32 × 32 rund med tooltip. |
| **StatusPill** | ok, warn, error, broken, paused, info, draft | Højde 24, padding 4/10, ikon 14 + tekst 12/600. Kompakt variant (kun prik 8 px + tekst) i underrækker. |
| **ModeBadge** | Live, Kladde, Test | Se 2.3. Højde 22. |
| **ConnectorLogo** | 24, 32, 48 | Hvid firkant, radius 8, border. Fallback: initialer 600 på `--color-bg-base`. |
| **ConnectorPair** | 1→N | Kildelogo, pil `arrow-right` 14 px fg-3, op til 4 destinationslogoer overlappet med 6 px og "+N" |
| **StatCard** | hvid, lime, kompakt | Label 13/500 fg-2, tal 40/700, enhed 16/500 fg-3, trend (pil og procent 13/600 fg-1, ikke rød/grøn), sparkline 32 px høj i fg-3 med lime sidste punkt |
| **DataTable** | standard, udfoldelig (træ), valgbar | Header 40 px (12/600 fg-2, sticky). Række 44 px (kompakt 36). Linjer 1 px `--color-border`. Hover `--color-bg-base` 50 %. Valgt række får en lime venstrekant på 2 px (eneste tilladte accentkant). Underrækker er indrykket 40 px med tynd forbindelseslinje. Handlinger vises ved hover og altid ved fokus. |
| **FilterChip** | inaktiv, aktiv, med tæller, med fjern-kryds | Pill 32 px. Aktiv: lime fyld og mørk tekst 600. |
| **Tabs** | side-faner, inspektør-faner, segmenteret kontrol | Side-faner: 14/600, aktiv mørk med 2 px understregning. Segmenteret: pill-gruppe til fx "I dag / 7 dage / 30 dage". |
| **Input / Select / Combobox** | standard, med ikon, fejl, deaktiveret, skrivebeskyttet | 40 px (36 i inspektør og tabeller). Radius 8. Label 13/500 over feltet, hjælpetekst 12 under. Fejl: `--status-error-fg` ring, ikon og tekst under. Combobox med søgning bruges til kontoplan-opslag med kontonummer i monospace. |
| **Switch / Checkbox / Radio** | – | Switch: tændt er mørk spor med hvid knop og lime prik (ikke lime spor, af kontrastgrunde). |
| **Accordion ("Avanceret")** | lukket, åben | Header 40 px med `chevron-right` og eyebrow-tekst. Tilstanden huskes. |
| **Tooltip / Popover** | – | Tooltip: navy, hvid tekst 12, radius 8. Popover: hvid, `--shadow-card`, radius 16. |
| **Dialog** | standard, destruktiv, "Gå Live" | 480 px (diff-dialog 720). Titel 16/600, brødtekst, handlinger højrestillet. Destruktiv kræver indtastning af navnet. "Gå Live" viser hvad der skrives hvorhen og har en afkrydsning "Jeg forstår, at der bogføres i Dinero". |
| **Toast** | ok, fejl, info, med handling ("Fortryd") | Nederst til højre, 360 px, forsvinder efter 6 s (fejl bliver stående) |
| **Banner** | warn, error, info | Inde i kort eller globalt (3.2) |
| **EmptyState** | første gang, intet resultat af filter, ingen adgang | 24 px ikon i 48 px cirkel `--color-bg-base`, titel 16/600, tekst 14 fg-2, primær handling |
| **Skeleton** | tabelrække, kort, graf | `--color-bg-base` puls (slås fra ved reduced motion) |
| **ErrorCard** | forretning, udvikler | "Hvad skete der" (16/600), "Hvorfor" (14), "Sådan løser du det" (nummereret), knapper Gentag og Åbn indstilling. Udviklerdelen kan foldes ud: fejlkode, request/response i monospace med kopiér-knap og maskerede felter. |
| **KeyValueList** | – | Til metadata: label 12 fg-2 og værdi 13 fg-1, to kolonner |
| **UsageMeter** | lys, navy | 8 px spor, lime fyld. Over 80 % får fyldet warn-farve med tekst. |
| **Avatar / UserChip** | – | Rund 28 px, initialer. Agentor support vises med trekant-ikon og mærket "Support". |
| **CommandPalette (⌘K)** | – | Dialog 640 px: søg i flows, forbindelser, ordrenumre og sider samt hurtighandlinger ("Nyt flow") |
| **Editor-komponenter** | Node, Port, Route, Palette, Inspector, ValidationPanel, MiniMap | Se afsnit 6 |

## 5. Mønstre

### 5.1 Status

Status beregnes pr. rute og rulles op til flow og dashboard efter reglen *værste vinder*. Pauset tæller ikke som fejl. Overalt hvor en status vises, vises også *hvornår* ("Fejl · siden 14:02") og *hvad man gør* via handling eller link. Rækkefølge efter alvor: Afbrudt > Fejl > Advarsel > Aktiv > Test > Pauset > Kladde.

### 5.2 Tabeller

- Kolonner kan sorteres og skjules (menu ved headeren). Filtre ligger som chips over tabellen og gemmes i URL'en.
- Tal højrestilles. Tid vises relativt ("for 4 min. siden") med eksakt tid i tooltip.
- Masseredigering: når rækker vælges, erstattes værktøjslinjen af en handlingsbjælke ("3 valgt · Pause · Genoptag · Fjern valg").
- Paginering med 50 pr. side. Aktivitet bruger uendelig scroll med "Indlæs flere".

### 5.3 Formularer og inspektør

- Formularer genereres fra JSON Schema. Felterne er grupperet i sektioner med titel 16/600 og en kort forklaring.
- Ændringer gemmes eksplicit med Gem og Annullér i en sticky footer, aldrig auto-gem i konfiguration. Ugemte ændringer vises med en prik på fanen og en advarsel ved navigation.
- Validering ved blur og ved gem. Fejl vises ved feltet og samles øverst ved gem ("2 felter mangler").
- Afhængige felter ("Flere indstillinger vises, når … er slået til") vises indrykket 16 px under deres switch.

### 5.4 Indlæsning, tom og fejl

Hver liste og hvert kort designes i fire tilstande: indhold, skeleton, tom (med forklaring og handling) og fejl ("Kunne ikke hente data · Prøv igen"). Ingen adgang vises som en tom tilstand med lås-ikon og "Bed en administrator om adgang".

### 5.5 Bekræftelser

| Handling | Mønster |
| --- | --- |
| Pause, genoptag, kør nu, gentag | Ingen dialog. Toast med "Fortryd" i 6 s. |
| Publicér uden Live-ændringer | Diff-dialog med Publicér |
| Publicér med skift til Live mod ERP | Diff-dialog og afkrydsning ("Gå Live") |
| Slet flow eller afbryd forbindelse | Destruktiv dialog med indtastning af navn og konsekvenser listet |
| Efterindlæs med "overskriv" | Dialog med antal records, der berøres |

### 5.6 Notifikationer

Klokken i topbjælken åbner en popover (400 px) med faner *Kræver handling* og *Alle*. Hvert punkt har status-ikon, titel, flow-navn, tid og én handling. Kritiske hændelser (afbrudt forbindelse, systematisk fejl) kan desuden sendes som push, e-mail og SMS efter brugerens valg.

## 6. Flow-editoren

Editoren er produktets vigtigste skærm og skal føles som et præcist værktøj, ikke et legetøj. Kilden står til venstre, destinationerne til højre, og brugeren trækker ruter mellem entitetsporte. Indstillingerne ligger pr. rute i inspektøren til højre.

### 6.1 Layout ved 1440 × 900 (sidebar foldet til 64)

| Zone | Mål | Indhold |
| --- | --- | --- |
| Editor-topbjælke | 56 px, hvid, bundlinje | Tilbage-pil, flownavn (kan redigeres inline), versionsstatus ("Publiceret v7 · Kladde med 3 ændringer"), knapper: Fortryd/Gendan (ikon), Liste/Lærred (segmenteret), **Validér** (ghost), **Testkør** (secondary), **Publicér** (primary lime), menu (…) |
| Palet (venstre) | 240 px, hvid | Søgefelt, grupper med eyebrow (WEBSHOP, ERP, CRM, MARKETING), rækker med logo, navn og status for kundens forbindelser, "+ Tilføj forbindelse". Destinationsgrænse vises nederst: "2 af 3 destinationer brugt · Flere kræver Enterprise". |
| Lærred | resten | Canvas `--color-bg-base` med prikgrid. Zoom-kontroller og minimap nederst til venstre (pill-gruppe). |
| Inspektør (højre) | 440 px | Kontekstafhængig: intet valgt = flowindstillinger og en klartekstforklaring af flowet, node valgt = forbindelse, rute valgt = 5 faner |
| Bundpanel | 0 / 240 px, kan trækkes | Faner "Validering (2)" og "Testkørsel". Lukket som standard. Åbnes automatisk ved fund. |

### 6.2 Node

- Bredde 240 px, radius 12, hvid, `--shadow-sm`. Header 56 px med logo 32, forbindelsesnavn 14/600, konto 12 fg-2 og sundhedsprik.
- Under headeren en række pr. entitet (36 px). Kilde har porten til højre, destination til venstre. Porten er en cirkel på 10 px: udfyldt mørk = forbundet, hul = ledig, lime med ring = gyldigt mål under træk, nedtonet 30 % = ukompatibel under træk.
- Destinationsporte viser rutens tilstand til højre (ModeBadge, lille).
- Fodlinje ved behov: "Opdatering tilgængelig v2.0" (info) eller "Forbindelse afbrudt – genautentificér" (broken).
- Valgt node: 2 px mørk ring. Validering: rød eller gul cirkel med tal i øverste højre hjørne.

### 6.3 Rute (kant)

- Bezier fra port til port, 1.5 px `--color-fg-3`. Live er fuld linje, Test er stiplet (5/4), og pauset er stiplet i 40 % opacitet.
- Status vises som et lille mærke midt på ruten, men kun ved Advarsel, Fejl eller Afbrudt (ikon i status-bg-cirkel på 20 px). Aktive ruter har intet mærke, så lærredet forbliver roligt.
- Valgt rute: 2.5 px lime med mørk 1 px kontur, så lime er synlig på lys canvas. Hover: 2 px mørk.
- Afhængighedsmærke: lille chip ved destinationsnoden, fx "+ produkter" med tooltip "Ordrer kræver, at produkterne findes i Dinero. Oprettes automatisk."
- Aktiv kørsel: en lime prik vandrer langs ruten (slås fra ved reduced motion).

### 6.4 Inspektør for rute

Header: "Ordrer → Dinero Fakturaer", ModeBadge, StatusPill og menu (pause, slet rute). Faner:

1. **Generelt:** aktiv-switch, tilstand (segmenteret Test / Kladde / Live), "Send når" (select med ordrestatus), "Opdatér eksisterende" (switch), matchfelt (select). Avanceret: konfliktregel, idempotensnøgle.
2. **Mapping:** sektionerne Konti (momspligtigt salg, momsfrit, EU B2B, udland, fragt momspligtig/momsfri), *Kategori → konto* (tabel med kategori, konto via combobox, momskode og antal produkter, plus "+ Undtagelse for produkt") og Fakturaindstillinger (bogfør, skabelon, sprog, header med shortcodes). Avanceret: felt-til-felt-tabel (kildefelt → målfelt → udtryk) med live-preview på et eksempelrecord.
3. **Filtre:** regelbygger med rækker (felt, operator, værdi) og OG/ELLER-grupper samt en opsummering i klartekst øverst ("Kun ordrer med land = DK og total > 0").
4. **Kørsel:** "Kør nu", "Efterindlæs" (datointerval, overskriv/spring over), polling-interval (låst til planen med upsell-tekst), retry-politik (avanceret).
5. **Historik:** de seneste 20 kørsler (tid, antal, udfald) og fejlede records med "Gentag". Avanceret: request/response.

### 6.5 Interaktioner

| Handling | Adfærd |
| --- | --- |
| Træk forbindelse fra paletten | Noden placeres i destinationskolonnen. Auto-layout justerer. Ved over 3 destinationer uden Enterprise afvises slip med en tooltip og et upsell-link. |
| Træk fra port | Kompatible porte lyser (lime ring), ukompatible nedtones. Slip på gyldig port opretter ruten i Test og åbner inspektøren på Mapping. |
| Klik på rute eller node | Vælger og åbner inspektøren. Esc fravælger. |
| Delete / Backspace | Sletter valgt rute efter bekræftelse i en popover |
| ⌘Z / ⌘⇧Z | Fortryd/gendan i kladden |
| Validér | Bundpanelet åbner med fund. Klik på et fund vælger ruten og fokuserer feltet. |
| Testkør | Bundpanelet viser pr. rute: antal records, "ville oprette / opdatere / springe over", før/efter-visning for et valgt record |
| Publicér | Diff-dialog (5.5). Efter publicering vises en toast, og versionsstatus bliver "Publiceret v8". |
| Anden bruger redigerer | Banner øverst: "Mette redigerer dette flow · Åbnet skrivebeskyttet". Alt er nedtonet og kan ikke redigeres. |

### 6.6 Listevisning (tilgængelig og tablet)

Samme flow som tabel: grupperet pr. destination med rækker pr. rute (entitet, tilstand, status, filtre i klartekst). Valg af række åbner samme inspektør. "+ Tilføj rute" åbner en dialog med kildeport → destination → destinationsport. Fuldt tastaturbetjent.

### 6.7 Skabelonvælger og guide

"Nyt flow" åbner en dialog (880 px) med skabelonkort i et 3-kolonners grid: logoer, titel, én linje og entiteter. Der er også kortet "Start fra blankt". Efter valg åbner editoren med noderne placeret og en **guide** øverst i inspektøren: en tjekliste med 4 trin (Forbind WooCommerce, Forbind Dinero, Udfyld konti, Testkør) med fremdrift. Hvert trin springer til det rette sted.

## 7. Skærmspecifikationer, runde 1

Runde 1 består af 14 desktop-skærme og 4 mobilskærme, prioriteret i rækkefølge. Hver skærm leveres i de angivne tilstande.

| # | Skærm | Indhold (top → bund) | Tilstande |
| --- | --- | --- | --- |
| D1 | **Overblik** | Sidehoved "God eftermiddag, Mette" og periodevælger (I dag / 7 dage / 30 dage). Sundhedsbånd: 5 klikbare tællere (Aktiv 5, Advarsel 1, Fejl 1, Afbrudt 0, Pauset 1). 4 StatCards: synkroniseret omsætning (lime, 184.320 kr.), ordrer (412), records (1.906), fejlrate (0,4 %). "Kræver handling"-kort med 3 punkter og én knap hver. Forbrugskort (transaktioner 1.420/2.000, integrationssæt 2/alle). "Seneste aktivitet" med 8 kørsler. | Alt kører · Problemer (2 fejl + 1 afbrudt) · Ny kunde med onboarding-tjekliste |
| D2 | **Integrationer** | Sidehoved med "Nyt flow". Værktøjslinje med søgning, filterchips (Status, Kilde, Destination, Tilstand) og "Fold alle ud". Tabel med 6 flows. Flow 2 er foldet ud med 4 ruter i blandet status (Aktiv/Live, Fejl/Live, Test, Pauset). | Standard · Med valg (masseredigering) · Tom (skabelonkort) · Planens grænse nået (deaktiveret CTA med tooltip) |
| D3 | **Editor: rute valgt** | WooCommerce → Dinero (Fakturaer, Kreditnotaer, Kunder), HubSpot (Kontakter, Test) og Brevo (Kontakter). Ruten Ordrer → Dinero Fakturaer er valgt med Mapping-fanen åben og *Kategori → konto* med 6 kategorier og 1 produktundtagelse. | Standard · Under træk (gyldige/ugyldige porte) · Valideringsfejl (manglende EU B2B-konto, bundpanel åbent) |
| D4 | **Editor: skabelon og guide** | Skabelonvælger-dialog, derefter editoren med guide-tjeklisten (2 af 4 trin gennemført) | 2 skærme |
| D5 | **Testkørsel og publicér** | Bundpanel med testresultat (10 records: 9 ville oprettes, 1 sprunget over), før/efter for én ordre. Diff-dialog med "Gå Live"-afkrydsning. | 2 skærme |
| D6 | **Editor: listevisning** | Samme flow som tabel, inspektør åben | 1 skærm |
| D7 | **Flowdetalje: Oversigt** | Header med navn, StatusPill, handlinger (Kør nu, Pause, Åbn editor). Miniature af grafen. Klartekstforklaring. Rutekort med nøgletal. | Standard · Med fejl |
| D8 | **Flowdetalje: Kørsler → record med fejl** | Tidslinje over kørsler, valgt kørsel med records, én fejlet record åben i et sidepanel med ErrorCard. Forretningsvisning og udviklervisning (request/response foldet ud). | 2 skærme |
| D9 | **Forbindelser** | Liste i kortgrid (logo, konto, status, token-udløb, "bruges i N flows"). Detalje for Dinero med "Afbrudt – genautentificér"-banner. | Liste · Detalje afbrudt |
| D10 | **Aktivitet** | Filtre (flow, entitet, udfald, dato, fritekst), tabel med records, fanen Afstemning med dagstabel (ordrer i kilde vs. fakturaer i ERP, afvigelser markeret) | Log · Afstemning |
| D11 | **Indstillinger: Team og adgang** | Brugerliste med rolle og adgangsomfang ("Alle flows" / "2 flows" / "Udløber 12. nov."). Invitér-dialog med valg af rolle og flows. | Liste · Invitér-dialog |
| D12 | **Indstillinger: Notifikationer og Sikkerhed** | Matrix med hændelser × kanaler (in-app, e-mail, push, SMS), tærskler og stilletid. Sikkerhed: MFA, passkeys, sessioner, support-godkendelse (D8). Audit-log med supportadgang synlig. | 3 skærme |
| D13 | **Abonnement og forbrug** | Nuværende plan (Business), forbrugsmålere, sammenligning af Startup 79 / Business 159 / Enterprise 299 kr./md., betalingsmetode (QuickPay, kort •••• 4242), fakturaliste | 1 skærm |
| D14 | **Login, MFA og onboarding** | Login (e-mail, adgangskode, passkey), MFA-kode, onboarding i 3 trin (virksomhed via CVR-opslag, plan og betaling, skabelon) | 5 skærme |

## 8. Mobil / PWA

Mobil er til overvågning og hurtige reaktioner. Den bruges ikke til konfiguration. Design på 390 × 844 med sikre zoner.

- **Navigation:** bundbar på 64 px + safe area med 4 punkter (Overblik, Integrationer, Aktivitet, Notifikationer). Aktiv er en lime pill bag ikonet. Topbar 52 px med logo, tenant-navn og avatar.
- **Gutter 16 px.** Kort fylder bredden. Stat-tal er 24/700 i et 2 × 2-grid.
- **Integrationer:** liste af kort (ikke tabel). Kortet viser navn, ConnectorPair, status og sidste kørsel. Tryk folder ruterne ud som en liste inde i kortet. Swipe eller …-menu giver Pause, Genoptag, Kør nu og Gentag fejlede.
- **Fejl:** ErrorCard i fuld bredde med Gentag. "Vis tekniske detaljer" er erstattet af "Send link til min computer".
- **Editor-ruter** viser en skærm "Redigering kræver en computer" med knappen "Send link pr. e-mail".
- **Offline:** et gråt banner "Offline · data fra kl. 14:02", og handlinger er deaktiveret.
- **Installation:** en iOS-guide (3 trin: Del → Føj til hjemmeskærm → Tillad notifikationer) vises som et bundark første gang.
- **Push-eksempler** (designes som preview): "Fejl i Webshop → regnskab: 3 ordrer kunne ikke bogføres i Dinero", "Dinero-forbindelsen er afbrudt – genautentificér". Ingen persondata.

**Mobilskærme i runde 1:** M1 Overblik, M2 Integrationer med ét kort foldet ud, M3 Fejldetalje med Gentag, M4 Notifikationer.

## 9. Tilgængelighed, sprog og mikrotekst

### 9.1 Tilgængelighed (WCAG 2.2 AA)

- Kontrast: tekst mindst 4,5:1 og UI-elementer og ikoner mindst 3:1. Lime (#D0E84A) har kun mørk tekst. Lime bruges aldrig som tekstfarve eller tynd linje på hvid uden mørk kontur.
- Fokus er synligt overalt: 2 px #1A1A18-ring med 2 px afstand. På navy er ringen hvid.
- Klikflader er mindst 24 × 24 px på desktop og 44 × 44 px på mobil.
- Status har altid tekst. Grafer har tekstalternativ (tal i tooltip og tabel).
- Editoren har listevisning, og alle lærredshandlinger kan udføres fra tastatur via listevisning og inspektør.

### 9.2 Sprog og tone

Dansk er standard, og engelsk skal kunne vises uden layoutbrud (engelske tekster er ca. 15 % kortere, tyske op til 30 % længere: lad plads). Tonen er venlig, direkte og konkret. Vi skriver "du" og bruger aktive verber. Ingen teknisk jargon i standardlaget.

| Brug | Undgå |
| --- | --- |
| Flow, rute, forbindelse, kørsel | Pipeline, edge, credential, job |
| "3 ordrer kunne ikke bogføres i Dinero" | "Sync failed (422)" |
| "Kontoen 1010 findes ikke længere i Dinero. Vælg en ny konto for EU-salg." | "Invalid account reference" |
| "Gå Live" / "Testkør" / "Publicér" | "Deploy" / "Run" / "Commit" |
| "Synkroniseret omsætning" (med tooltip om, at det ikke er bogført omsætning) | "Omsætning" alene |

### 9.3 Formater

da-DK: 1.234,50 kr. · 18. okt. 2026 · 14:02 · relativ tid "for 4 min. siden". Ordrenumre vises med # (#10432). Id'er i monospace med kopiér-ikon.

## 10. Eksempeldata, leverancer og accept

### 10.1 Eksempeldata (fiktive)

| Felt | Værdi |
| --- | --- |
| Tenant | Nordlys Cykler ApS, CVR 12345678, Aarhus |
| Brugere | Mette Holm (Ejer), Jonas Krag (Admin), Freelance: Sara Lind (Udvikler, adgang til 1 flow, udløber 12. nov.), Revisor: Bo Dahl (Læser) |
| Forbindelser | WooCommerce "nordlys-cykler.dk", Shopify "Nordlys Outlet", Dinero "Nordlys Cykler", HubSpot "Nordlys Cykler", Brevo "Nyhedsbrev", e-conomic "Nordlys Outlet" (afbrudt) |
| Flows | "Webshop → regnskab og CRM" (WooCommerce → Dinero, HubSpot, Brevo), "Outlet → regnskab" (Shopify → e-conomic), "Lager retur" (Dinero → WooCommerce, pauset), "Kunder til nyhedsbrev" (Shopify → Brevo), "B2B-ordrer" (kladde), "Kreditnotaer" (WooCommerce → Dinero) |
| Kategorier → konti | Cykler → 1000 Salg, Reservedele → 1000 Salg, Tøj → 1020 Salg tøj, Gavekort → 6900 Gavekort (momsfri), Service → 1030 Værkstedssalg, Fragt → 1100 Fragt. Undtagelse: "Cykelhjelm Pro" → 1020. |
| Ordrer | #10421–#10460, beløb 249–18.995 kr. Fejleksempel: #10447 "Konto 1010 Salg EU findes ikke i Dinero". |

Brug ingen rigtige virksomheder, kunder eller kontonumre fra eksisterende kunder.

### 10.2 Leverancer i runde 1

1. **Design-tokens og komponentark** (afsnit 2 og 4), inkl. statusfarver med dokumenteret kontrast.
2. **14 desktop-skærme** (D1–D14) med tilstandene fra afsnit 7.
3. **4 mobilskærme** (M1–M4).
4. **Prototype-sti** for kerneflowet: Overblik → Integrationer → fold flow ud → åbn editor → vælg rute → ret konto → testkør → publicér.

### 10.3 Acceptkriterier

- [ ] Kun tokens fra afsnit 2. Ingen nye farver, radier eller skygger.
- [ ] Hver status vises med ikon og tekst. Kontrast er verificeret.
- [ ] "Kører alt?" kan besvares på Overblik uden scroll ved 1440 × 900.
- [ ] Integrationstabellen viser flow- og ruteniveau tydeligt adskilt.
- [ ] Editoren kan læses ved 1280 px uden overlap. Inspektøren skjuler ikke den valgte rute.
- [ ] Alle lister har tom-, indlæser- og fejltilstand.
- [ ] Dansk mikrotekst følger 9.2. Ingen lorem ipsum.
- [ ] Mobil indeholder ingen konfiguration.

## 11. Startprompt til Claude Design

Kopiér prompten herunder ind i et nyt design i Claude Design. Vedhæft først mappen *Design System – Agentor Web* (styles.css, tokens/, BRAND-CONTINUITY.md, DESIGN-RULES.md, assets/logo.svg, logo-white.svg og icon-triangle.svg) og links til de to specifikationer. Prompten arbejder i tre etaper med stop efter hver, så retningen kan rettes tidligt.

```markdown
Du er senior produktdesigner på Agentor, en dansk SaaS-tjeneste, der automatisk synkroniserer data mellem webshops (WooCommerce, Shopify) og ERP-, CRM- og marketingsystemer (Dinero, e-conomic, HubSpot, Brevo, Mailchimp). Du skal designe web-app'en app.agentor.dk, runde 1.

GRUNDLAG (vedhæftet – læs alt før du designer)
1. "Agentor App — Designspecifikation v1": bindende for alt visuelt og interaktion. Ved konflikt vinder den.
2. "Agentor App — Produkt- og løsningsspecifikation v1.1": funktioner, sider, roller, statusmodel.
3. "Design System – Agentor Web": brandet. Genbrug tokens, logo, Plus Jakarta Sans og Lucide-ikoner (v0.460) nøjagtigt. Opfind ikke nye farver, radier, skygger eller afstande.

MÅLGRUPPE OG MÅL
- Forretningsejere med teknisk forståelse og udviklere/bureauer. Desktop først (1440 × 900, minimum 1280), mobil (390 × 844) kun til overvågning.
- Nøgleord: overblik og brugervenlighed. Brugeren skal kunne svare på "kører alt?" på 3 sekunder og vide, hvad der skal gøres ved det, der ikke kører.
- Udtryk: roligt, præcist driftsværktøj med Agentors brand. Lime #D0E84A er handling og fremhævning, ikke baggrund overalt. Hvide arbejdsflader på varm canvas #F0EDE8. Navy #13293A sidebar. Mørk tekst #1A1A18.

GODKENDTE APP-UNDTAGELSER FRA WEB-REGLERNE
- Canvas #F0EDE8 bag hvide flader.
- Statusfarver (kun til status, altid med ikon og tekst): Aktiv #2F7D4F/#E6F2EA, Advarsel #A86412/#FBF0DC, Fejl og Afbrudt #B42318/#FBE7E4, Pauset #6B6B67/#EFEDE8, Test/Info #2B5C8A/#E5EDF5, Kladde stiplet ramme.
- Primære CTA'er er pill med UPPERCASE 12/700 +0.10em. Tætte knapper i tabeller og paneler er pill med sentence case 13/600.
- 1 px #E4E1DB-linjer i tabeller og inputs. Kort har skygge uden border.
- App-typeskala: 28/600 sidetitel, 20/600 sektion, 16/600 korttitel, 14/400 brødtekst, 13 tabel, 12 metadata, stat-tal 40/700. JetBrains Mono 12.5 kun til id'er, JSON og udtryk.
- App-skal: navy sidebar 240 px (64 foldet) med lime pill som aktivt punkt, topbjælke 56 px med ⌘K-søgning, notifikationer og avatar.

KERNEBEGREBER (brug ordene præcis sådan i UI'et)
Forbindelse = kundens konto i et system. Flow = én integration med én kilde og op til 3 destinationer (flere kræver Enterprise). Rute = forbindelse fra en kildeport (fx Kunder) til en destinationsport (fx HubSpot Kontakter). Indstillinger, mapping, filtre og tilstand ligger pr. rute. Tilstand: Test, Kladde, Live. Status: Aktiv, Advarsel, Fejl, Afbrudt, Pauset, Test, Kladde. Status beregnes pr. rute og rulles op (værste vinder).

ETAPE 1 – FUNDAMENT (stop og vis mig, før du går videre)
Lav et komponentark med tokens (farver inkl. status med kontrastværdier, typografi, afstande, radier, skygger) og komponenterne fra designspecifikationens afsnit 4 i alle tilstande: Button, StatusPill, ModeBadge, ConnectorLogo og ConnectorPair, StatCard, DataTable (inkl. udfoldelig række), FilterChip, Tabs, Input/Select/Combobox, Switch, Accordion "Avanceret", Dialog (standard, destruktiv, Gå Live), Toast, Banner, EmptyState, Skeleton, ErrorCard og UsageMeter. Vis også app-skallen tom ved 1440 px.

ETAPE 2 – KERNESKÆRME (stop og vis mig)
D1 Overblik ("alt kører" og "problemer"), D2 Integrationer (udfoldelig tabel: 6 flows, ét udfoldet med 4 ruter i blandet status), D3 Flow-editor med ruten "Ordrer → Dinero Fakturaer" valgt og Mapping-fanen åben.
Editoren: palet 240 px til venstre, lærred med prikgrid, inspektør 440 px til højre med fanerne Generelt, Mapping, Filtre, Kørsel og Historik. Kildenode WooCommerce (portene Ordrer, Kreditnotaer, Kunder, Produkter) til venstre. Destinationer til højre: Dinero (Fakturaer, Kreditnotaer, Kunder – alle Live), HubSpot (Kontakter, Test, stiplet rute) og Brevo (Kontakter, Live). Kunder går altså til tre destinationer. Valgt rute er lime med mørk kontur. Afhængighedschip "+ produkter" ved Dinero. Mapping viser konti og en tabel "Kategori → konto" med 6 kategorier og 1 produktundtagelse.
Vis også D3 under træk (gyldige porte med lime ring, ugyldige nedtonet) og med en valideringsfejl (manglende konto for EU B2B-salg, bundpanel åbent).

ETAPE 3 – RESTEN AF RUNDE 1
D4–D14 og M1–M4 som beskrevet i designspecifikationens afsnit 7 og 8, inkl. de angivne tilstande. Lav til sidst en klikbar prototype-sti: Overblik → Integrationer → fold flow ud → åbn editor → vælg rute → ret konto → testkør → publicér (Gå Live-dialog).

INDHOLD OG SPROG
- Al tekst på dansk, "du"-form, venlig og konkret. Ingen lorem ipsum og ingen engelsk jargon (ikke pipeline, deploy, job eller edge).
- Brug eksempeldata fra designspecifikationens afsnit 10.1: Nordlys Cykler ApS, brugerne Mette Holm, Jonas Krag, Sara Lind (ekstern udvikler med adgang til 1 flow) og Bo Dahl, ordrer #10421–#10460, konti som 1000 Salg, 1010 Salg EU og 1100 Fragt.
- Formater: 1.234,50 kr. · 18. okt. 2026 · "for 4 min. siden".
- Fejl forklares som hvad, hvorfor og næste handling, fx "Kontoen 1010 findes ikke længere i Dinero. Vælg en ny konto for EU-salg."

KVALITETSKRAV
- WCAG 2.2 AA. Lime kun med mørk tekst. Synlig fokusring (2 px #1A1A18). Status aldrig kun farve.
- Hver liste og hvert kort har tom-, indlæser- og fejltilstand.
- Generiske komponenter: formularer, porte og mappingfelter skal kunne fyldes af enhver connector. Ingen særdesign til ét system.
- Overblik skal besvare "kører alt?" uden scroll ved 1440 × 900.
- Mobil indeholder ingen konfiguration. Editoren viser "Redigering kræver en computer".

Når du er i tvivl, så vælg det roligste og mest læsbare. Skriv kort, hvilke antagelser du har gjort, når du viser hver etape.
```
