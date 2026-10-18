# Agentor App — Produkt- og løsningsspecifikation v1.0

Oct 18, 2026 · @Charlie Nielsen

Specifikationen beskriver app.agentor.dk v1. Den skal godkendes, før designet laves i Claude Design. Den erstatter udkastet *saas-specification-tenant-isolation.md* og sitemappet *sitemap-page-specifications.md*. Den vigtigste revision er skiftet fra MySQL med ren applikationsisolering til PostgreSQL med Row-Level Security. Driften flytter samtidig fra managed cloud-tjenester til den eksisterende Ubuntu/Plesk-server.

## 0. Status og revisionslog

**Status:** Godkendt 18. okt. 2026 (v1.1). Designet laves ud fra den separate designspecifikation. Forfattere: Solution Architect (iPaaS/SaaS) og DevOps/Software Engineer. Beslutningerne står i afsnit 14.3.

**Sådan læses dokumentet:** Afsnit 1–8 er produktet, dvs. hvad der skal designes. Afsnit 9–12 er platformen, dvs. hvad der skal bygges og drives. Afsnit 13 er den samlede brief til Claude Design.

### Ændringer i forhold til udkastene

| Område | Udkast | Revideret | Begrundelse |
| --- | --- | --- | --- |
| Database | MySQL 8, isolering kun i applikationen | PostgreSQL med `tenant_id` og RLS (FORCE) på alle tenant-tabeller | Databasen håndhæver selv tenant-grænsen, også hvis applikationen har en fejl. Den åbne beslutning fra udkastets afsnit 13 er hermed lukket. |
| Hosting | Managed MySQL, Upstash, AWS KMS, Cloudflare | Én delt Ubuntu/Plesk Obsidian VM med PM2, lokal PostgreSQL og dedikeret Redis-instans | Det er det givne driftsmiljø for v1. Kontrollerne er tilpasset derefter (afsnit 9 og 10). |
| Nøglehåndtering | Cloud-KMS | Lokal envelope-kryptering: master-nøgle uden for webroot og kun læsbar for worker-brugeren; nøgle pr. tenant | Der er ingen KMS på VM'en. Designet gør det muligt at skifte til Vault eller cloud-KMS uden datamigrering. |
| Auth | Auth.js eller Clerk | Selv-hostet (Better Auth eller Auth.js) med TOTP-MFA og passkeys | Clerk er en tredjelands-subprocessor. Selv-hosting holder persondata i EU. |
| Integrationstopologi | 1:1 (åbent spørgsmål) | Én kilde pr. flow, 1:N destinationer; N:1 opnås med flere flows | Behovet for fan-out (kunder til ERP, CRM og nyhedsbrev) kræver 1:N fra start. |
| Integrations-UI | Trin-for-trin-wizard og mapping-tabel | Node-baseret flow-editor med indstillinger pr. forbindelse (kant) | Ønsket af produktejer. Wizard bevares kun som skabelon til at komme i gang. |
| Planer | Startup / Standard / Enterprise | Startup 79, Business 159, Enterprise 299 DKK/md. (som på agentor.dk) | Følger den live prisside. Se dog åbent spørgsmål om "integrationssæt". |
| Audit-log | Åbent (MVP eller fase 2) | MVP | Tilbygning senere er dyrt, og B2B-kunder spørger efter det ved salg. |
| Support-adgang | Åbent | Break-glass via manage.agentor.dk med begrundelse, tidsbegrænsning og audit | Kunderne overlader nøgler til deres økonomisystem. Adgang skal kunne dokumenteres. |
| Fejl-payloads | Nævnt som risiko | Payloads krypteres, PII maskeres i logs, og der slettes automatisk efter 30 dage | GDPR-dataminimering. |

### Ændringer i v1.1 (18. okt. 2026)

- Beslutningerne D1–D9 er indarbejdet. Det gælder bl.a. maks. 3 destinationer pr. flow uden Enterprise, QuickPay-abonnementer og Better Auth.
- Adgang pr. integration (ACL) til eksterne udviklere er tilføjet (afsnit 6, 9.1 og 11).
- Afsnit 4.5 er nyt og forklarer, hvordan kundens mapping og indstillinger overlever connector-opdateringer.
- Support må udføre handlinger på kundens vegne under break-glass med fuld audit (9.7).
- Brevo er valgt til e-mail og SMS, og SMS er tilføjet som notifikationskanal for kritiske hændelser.
- KEK-placering er opdateret, og der er en note om Plesk-ejerskab (9.2).
- Editor-illustrationen er rettet, så kunder også føres til Dinero.
- 1440 px er standardbredden for design.

## 1. Formål, målgrupper og principper

App'en skal kunne besvare to spørgsmål på under 3 sekunder: *"Kører alt?"* og *"Hvad skal jeg gøre ved det, der ikke gør?"*. Konfiguration er sjælden. Overvågning sker dagligt. Designet prioriteres derefter.

### Målgrupper

| Persona | Typisk rolle | Primære opgaver | Enhed | Behov |
| --- | --- | --- | --- | --- |
| Forretningsejeren | Ejer eller driftsansvarlig i webshop med 1–20 ansatte, teknisk forstående | Oprette flow fra skabelon, følge status og omsætning, reagere på fejl | Desktop og mobil (PWA) | Klart sprog, fornuftige standardvalg, ingen JSON |
| Udvikleren / bureauet | Freelancer eller bureau, der sætter op for kunden | Avanceret feltmapping, filtre, gentagelse og afspilning af fejl, rå request/response, webhooks og API | Desktop | Fuld indsigt, kopierbare id'er, tastaturgenveje |
| Bogholderen / revisoren | Inviteret med læseadgang | Se, hvad der er bogført, afstemme og eksportere | Desktop | Sporbarhed og eksport (CSV) |
| Agentor support | Intern via manage.agentor.dk | Fejlsøge på kundens anmodning | Desktop | Break-glass-adgang med audit (afsnit 9) |

### Designprincipper

1. **Overblik før detaljer.** Hver side starter med status og tal. Detaljer foldes ud.
2. **Progressiv dybde.** Forretningsejeren ser standardlaget. Udviklerlaget ("Avanceret") ligger på samme side, ikke i et separat produkt.
3. **Sikkert som standard.** Nye ruter starter i *Test (dry-run)*. Bogføring i ERP kræver et aktivt valg. Intet slettes uden bekræftelse.
4. **Forklarlige fejl.** Hver fejl viser *hvad*, *hvorfor* og *næste handling* i almindeligt dansk. Rå data ligger under "Avanceret".
5. **Én sandhed pr. objekt.** En forbindelse (fx én Dinero-konto) oprettes én gang og genbruges i alle flows.

### Succeskriterier for v1

| Mål | Måling |
| --- | --- |
| Tid fra login til første aktive flow (WooCommerce → Dinero) | Median under 20 minutter uden support |
| Andel synkroniseringer uden manuel indgriben | Mindst 99 % af records pr. måned |
| Tid fra fejl til notifikation | Under 5 minutter (push/e-mail) |
| Cross-tenant datalæk | 0, verificeret af isolationstestsuite i CI og årlig pentest |

## 2. Scope

v1 leverer platformen og den node-baserede editor med fire kilder/destinationer i drift. Arkitekturen skal kunne bære hele kataloget i *Integrations.md* uden ændringer i kernen.

| Område | v1 (MVP) | Senere |
| --- | --- | --- |
| Kilder | WooCommerce, Shopify | Magento 2, PrestaShop, Shopware 6, DanDomain |
| ERP-destinationer | Dinero, e-conomic | Billy, Uniconta, Business Central, Fortnox m.fl. |
| Marketing/CRM-destinationer | HubSpot, Brevo, Mailchimp (kun kunder/kontakter) | Klaviyo, Pipedrive |
| Entiteter | Kunder, produkter, ordrer→fakturaer, kreditnotaer, lagerantal | Indløser-udbetalinger, lager/WMS-ordrer, abonnementer |
| Topologi | 1 kilde → N destinationer pr. flow | Flere kilder i samme flow, hvis der er reel efterspørgsel |
| Kørselstilstande | Test (dry-run), Kladde (draft), Live | Sandbox-miljø pr. tenant |
| Udvikler | Feltmapping med udtryk (JSONata), filtre, gentag/afspil, request/response-log, udgående webhooks | Offentligt REST-API, generisk HTTP-connector, egne connectors |
| Mobil (PWA) | Overblik, status, omsætning, notifikationer, pause/genoptag, gentag fejl | Offline-redigering (bevidst fravalgt) |
| Administration | Team (Ejer/Admin/Udvikler/Læser), MFA, audit-log, notifikationer, abonnement og forbrug. \
ACL pr. bruger, så eksterne udviklere kan tildeles adgang til specifikke integrationer og ikke alle. | SSO (Microsoft Entra), white-label, forhandlermodel |
| Afstemning | Simpel: "ordrer i kilde vs. fakturaer i ERP" pr. dag | Fuldt afstemningsdashboard og momsanomalier |
| Historisk import | Begrænset efterindlæsning (datointerval, manuel) | Guidet migrering som tilkøb |

**Ikke-mål for v1:** vilkårlig kodekørsel fra kunder (ingen JavaScript-trin), tovejs-synkronisering af samme entitet i samme flow, offline-redigering på mobil, white-label og forhandlermodel samt AI-mappingforslag (planlagt som "foreslå og bekræft" i fase 4).

## 3. Domænemodel og begreber

UI, kode og support skal bruge samme ord. Ordene herunder er bindende for design og tekster. Engelsk navn står i parentes og bruges i koden.

| Begreb | Definition | Eksempel |
| --- | --- | --- |
| **Connector** (connector) | Agentors modul for et eksternt system. Det er versioneret og beskrevet af et manifest. Kunden vælger det i kataloget. | "Dinero", v1.3.0 |
| **Forbindelse** (connection) | Kundens autentificerede konto i et system, dvs. connector, nøgler/OAuth og systemindstillinger. Den genbruges på tværs af flows. | "Dinero – 645163 DUCATI" |
| **Flow** (flow) | En integration: én kildenode og en eller flere destinationsnoder forbundet med ruter. Svarer til en række i integrationstabellen. | "Webshop → regnskab og CRM" |
| **Node** (node) | En forbindelse placeret i et flow. Kilde- og destinationsnoder har *porte* for de entiteter, de kan levere eller modtage. | WooCommerce-node med portene Ordrer, Kunder og Produkter |
| **Rute** (route) | En kant fra en kildeport til en destinationsport. Indstillinger, mapping, filtre og kørselstilstand ligger pr. rute. Det er den enhed, der har status. | Kunder → HubSpot Kontakter |
| **Entitet** (entity) | Datatype i Agentors fælles datamodel (Agentor Common Model). | Customer, Product, Order, CreditNote, StockLevel |
| **Mapping** (mapping) | Regler for, hvordan felter og værdier oversættes på en rute. Omfatter feltmapping, værdimapping (kategori → konto) og udtryk. | Kategori "Tøj" → konto 1010 |
| **Kørsel** (run) | Én udførelse af en rute for en batch eller hændelse, med start, slut, antal og udfald. | 14:02, 37 ordrer, 36 ok, 1 fejl |
| **Record** (record) | Ét objekt i en kørsel med eget udfald og sporbarhed fra kilde-id til destinations-id. | Ordre #10432 → faktura 2025-118 |
| **Transaktion** (transaction) | Faktureringsenhed: ét record skrevet med succes til én destination i Live-tilstand. Test og fejl tæller ikke. | 1 ordre til Dinero og HubSpot = 2 transaktioner |
| **Version** (flow version) | Uforanderligt snapshot af et flows graf og indstillinger. Kun den publicerede version kører. | v7 (publiceret), v8 (kladde) |

> **Besluttet (D1):** 1 integrationssæt = 1 flow med 1 kilde og op til 3 destinationer. Flere destinationer pr. flow kræver Enterprise.

## 4. Integrationsmodel og connectors

Alle integrationer passerer gennem Agentors fælles datamodel. En ny connector skal derfor kun kunne oversætte til og fra den fælles model. Den skal ikke kende de andre systemer. Det gør *N* connectors til *N* adaptere i stedet for *N²* parvise integrationer.

### 4.1 Dataflow pr. rute

1. **Hent:** Kildeforbindelsen modtager en webhook (signatur verificeres) eller poller efter en plan. Hændelsen lægges i køen med `tenant_id`, `connection_id` og en idempotensnøgle.
2. **Normalisér:** Kildeadapteren omdanner data til den fælles model (fx `Order`).
3. **Fan-out:** Motoren slår flowets publicerede version op og opretter ét job pr. rute, der matcher entiteten.
4. **Filtrér og map:** Rutens filtre og mapping anvendes. Afhængigheder løses, fx at en ordre til Dinero kræver, at kunden og produkterne findes i Dinero.
5. **Skriv:** Destinationsadapteren skriver i den valgte tilstand (Test, Kladde eller Live) og respekterer destinationens rate limit.
6. **Registrér:** Udfald, destinations-id og eventuel fejl gemmes. Krydsreferencen kilde-id ↔ destinations-id bruges til opdateringer og til at undgå dubletter.

### 4.2 Fan-out og topologi

- Et flow har præcis **én kildenode** og **1..N destinationsnoder**. Samme kildeport kan forbindes til flere destinationer, fx Kunder → Dinero, Kunder → HubSpot og Kunder → Brevo. Startup og Business tillader op til 3 destinationer pr. flow, og flere kræver Enterprise. Editoren viser grænsen i paletten.
- Ruter kører **uafhængigt**. En fejl mod HubSpot stopper ikke bogføringen i Dinero.
- **N:1** (to webshops til ét regnskab) opnås med to flows, der bruger samme Dinero-forbindelse. Rate limit og nummerserier deles korrekt, fordi de hænger på forbindelsen.
- **Retur-flows** (fx lagerantal fra ERP til webshop) er et separat flow med ERP'et som kilde. Motoren mærker skrivninger med oprindelse, så en ændring ikke sendes tilbage i ring (ekko-undertrykkelse).

### 4.3 Connector-manifest

Hver connector leverer et manifest. UI'et genereres ud fra det: porte, auth-formular, indstillinger og mappingfelter. Designet skal derfor bygge på generiske komponenter, ikke på skærme lavet til én bestemt connector. Hvordan kundens egne indstillinger og mapping overlever opdateringer, står i afsnit 4.5.

| Felt | Indhold |
| --- | --- |
| `id`, `version`, `kategori` | fx `dinero`, `1.3.0`, `erp` (webshop, erp, crm, marketing, indløser, lager, fil) |
| `auth` | `oauth2`, `api_key`, `basic` plus felter. Self-hosted URL'er SSRF-valideres. |
| `entities[]` | Pr. entitet: `read` og/eller `write`, `trigger` (`webhook` eller `poll` med minimumsinterval), understøttede tilstande (`dry_run`, `draft`, `live`) |
| `settingsSchema` | JSON Schema for forbindelses- og ruteindstillinger. Det driver formularerne (fx Dineros "Bogfør fakturaer", konti for momspligtigt salg) |
| `mappingTargets` | Felter, der kan mappes til, med type og krav samt opslagslister hentet live (kontoplan, momskoder, enheder) |
| `dependencies` | Implicitte forudsætninger, fx `Order@dinero` kræver `Customer@dinero` og eventuelt `Product@dinero` |
| `rateLimit` | Fx Shopifys leaky bucket eller Dineros grænse pr. minut. Bruges af køen pr. forbindelse. |
| `changelog` | Om versionen er *additive* eller *breaking*. Styrer opgraderingsflow og kundekommunikation. |

### 4.4 Versionering af connectors

Hver node er låst til en connector-major-version. Additive ændringer rulles automatisk ud. Breaking ændringer vises som "Opdatering tilgængelig" på noden med diff og testkørsel før opgradering. Ved udløb af supportvinduet (mindst 6 måneder) **pauses** ruten med en klar besked. Den migreres ikke stiltiende.

### 4.5 Kundeindstillinger og mapping ved opdateringer

Modellen understøtter n+1-mapping, fx et vilkårligt antal varekategorier til hver sin konto i ERP'et. Kundens indstillinger overlever også opdateringer af connectoren. Det sikres sådan:

- **Mapping er data, ikke kode.** Kategori → konto er en værditabel på ruten med et vilkårligt antal rækker, produktundtagelser og en standardkonto, når intet matcher. Kontoplan og momskoder hentes live fra ERP'et.
- **Stabile nøgler.** Indstillinger gemmes i flowversionen med faste nøgler (fx `invoice.bookAutomatically`), ikke efter formularens rækkefølge. Manifestet ejer nøgler og standardværdier. Kundens valg gemmes eksplicit.
- **Additiv opdatering** (ny indstilling eller entitet): eksisterende værdier røres ikke. Nye nøgler får en standardværdi, der bevarer den hidtidige adfærd.
- **Breaking opdatering** (fx nye momskoder hos Dinero): den nye major-version leverer et migreringsscript fra gamle til nye nøgler. Migreringen køres på en kladde, og kunden ser diff og testkørsel og publicerer selv. Kan en værdi ikke migreres automatisk, markeres feltet, og ruten bliver på den gamle version, indtil kunden har valgt.
- **Intet slettes stiltiende.** Ukendte eller udfasede nøgler bevares i versionshistorikken.
- **Ændringer i ERP'et opdages.** En konto, der er nedlagt i ERP'et, opdages ved validering før kørsel og giver status Advarsel i stedet for fejlede posteringer.

## 5. Node-baseret flow-editor

Editoren er det sted, hvor flows oprettes og redigeres. Kilden står til venstre, destinationerne til højre, og kunden trækker ruter mellem entitetsporte. Indstillinger ligger på den rute, der er valgt, i et panel i højre side. Editoren bygges med React Flow (`@xyflow/react`), som er MIT-licenseret og understøtter porte, validering, zoom og minimap.

&#91;embedded content: Flow-editor · koncept: 1 kilde, 3 destinationer og inspektør for valgt rute\]

Kunder sendes til tre destinationer: Dinero (Live), HubSpot (Test) og Brevo (Live). Ordrer → Dinero er valgt, så inspektøren viser rutens kontomapping. Ordreruten opretter også produkter i Dinero, selv om Produkter-porten ikke er forbundet. Det er en afhængighed, ikke en rute.

### 5.1 Layout

| Zone | Indhold |
| --- | --- |
| Topbjælke | Flowets navn (kan redigeres), versionsstatus ("Publiceret v7 · Kladde med ændringer"), knapperne **Validér**, **Testkør** og **Publicér**, undo/redo og menu (duplér, eksportér JSON, versionshistorik) |
| Venstre palet | Søgbart katalog over kundens eksisterende forbindelser og "Tilføj ny forbindelse". Grupperet efter kategori (Webshop, ERP, CRM, Marketing). Træk ind på lærredet. |
| Lærred | Kildenode til venstre og destinationsnoder til højre. Auto-layout som standard med mulighed for at flytte. Minimap og zoomkontroller. |
| Højre panel (inspektør) | Kontekstafhængigt: flowindstillinger, nodeindstillinger eller ruteindstillinger. Bredde ca. 420–480 px, kan foldes ind. |
| Bundpanel (kan foldes ud) | Valideringsfund og testkørselsresultater med records, "før/efter" og fejl |

### 5.2 Nodetyper

| Node | Porte | Visning på lærredet |
| --- | --- | --- |
| **Kilde** | Udgange pr. entitet, som connectoren kan levere (Ordrer, Kunder, Produkter, Kreditnotaer, Lager) | Logo, forbindelsesnavn, sundhedsprik, trigger ("Webhook" / "Hvert 15. min.") |
| **Destination** | Indgange pr. entitet, som connectoren kan modtage, med destinationens eget navn (fx HubSpot "Kontakter", Dinero "Fakturaer") | Logo, forbindelsesnavn, sundhedsprik, rate limit-forbrug |
| **Filter** (v1, valgfri) | 1 ind, 1 ud for samme entitet | Kort regel i klartekst: "Kun B2B-kunder", "Land = DK" |
| **Router** (v2) | 1 ind, N ud med betingelser | Grene med betingelser, fx "EU-ordrer → e-conomic A, resten → B" |

Filtre kan også sættes direkte på en rute. Filter-noden er kun til, når samme filter skal deles mellem flere ruter, så det bliver synligt på lærredet.

### 5.3 Ruter (kanter): indstillinger pr. forbindelse

En rute oprettes ved at trække fra en udgang til en kompatibel indgang. Ukompatible porte nedtones under træk, så kunden kun kan slippe på gyldige mål. På lærredet viser ruten entitet, tilstand (Test, Kladde eller Live) og status. Når ruten vælges, viser inspektøren fem faner:

| Fane | Forretningsejer (standard) | Udvikler ("Avanceret") |
| --- | --- | --- |
| **Generelt** | Aktiv/pauset, kørselstilstand, hvornår der sendes (fx "når ordren er Gennemført"), opdatér eksisterende ja/nej, matchfelt (fx e-mail) | Konfliktregel (kilde vinder, destination vinder, spring over), idempotensnøgle |
| **Mapping** | Guidet mapping fra manifestet. For Dinero: konti for momspligtigt og momsfrit salg, EU B2B, udland, fragt, refusion. Kategori → konto-tabel med produktundtagelser. Moms efter tre niveauer: butik → kategori → produkt. | Felt-til-felt-tabel med JSONata-udtryk, testværdi og live-preview på et eksempelrecord |
| **Filtre** | Regelbygger i klartekst (felt, operator, værdi) med OG/ELLER | Råt udtryk |
| **Kørsel** | Efterindlæs datointerval (overskriv eller spring over), "Kør nu" | Pollinginterval inden for planens grænse, batchstørrelse, retry-politik |
| **Historik** | Seneste kørsler for ruten og fejl med "Gentag" | Rå request/response (maskeret), afspil enkelt record |

**Afhængigheder vises, de skjules ikke.** Når kunden forbinder Ordrer → Dinero, viser ruten et mærke: "Opretter også kunder og produkter i Dinero". Afhængighedsindstillingerne (fx "Brug produkter i Dinero") kan redigeres fra samme panel. Det svarer til Dineros nuværende indstillingsstruktur (ordretype, kunder, fakturaer, produkter og kreditnotaer).

### 5.4 Validering, test og publicering

1. **Løbende validering:** Noder og ruter får en rød eller gul markør, når påkrævede felter mangler (fx ingen konto for EU B2B-salg). Bundpanelet lister fundene. Klik på et fund springer til feltet.
2. **Testkørsel (dry-run):** Kører den aktuelle kladde mod de seneste *n* rigtige records fra kilden (standard 10) uden at skrive. Resultatet vises pr. rute som "det ville blive oprettet" med før/efter-visning.
3. **Publicér:** Kræver grøn validering. Det viser et diff mod den publicerede version ("2 ruter ændret, 1 tilføjet"). Hvis en rute skifter til **Live** mod et ERP, kræves en eksplicit bekræftelse. Publicering opretter en ny uforanderlig version. In-flight kørsler gør færdigt på den gamle version.
4. **Rul tilbage:** Versionshistorikken kan genoprette enhver tidligere version som ny kladde.
5. **Samtidig redigering:** Kladden låses til én redaktør ad gangen ("Mette redigerer – åbn som skrivebeskyttet"). Realtids-samarbejde er ikke i v1.

### 5.5 Kom i gang: skabeloner

"Nyt flow" åbner en skabelonvælger med fx *WooCommerce → Dinero (bogføring)*, *Shopify → e-conomic* og *Webshop → Regnskab + CRM*. Der er også et tomt lærred. En skabelon placerer noder og ruter og åbner en kort guide i inspektøren: forbind konti, udfyld mapping og testkør. Guiden er erstatningen for den gamle wizard. Den kører *i* editoren, så kunden lærer værktøjet fra første dag.

### 5.6 Tilgængelighed i editoren

En node-editor er svær at bruge med tastatur. Derfor findes en **listevisning** af samme flow, hvor ruter er rækker med de samme inspektørfaner. Den er fuldt tastaturbetjent, bruges af skærmlæsere og er også visningen på tablet.

## 6. Informationsarkitektur og sitemap

App'en har syv hovedområder i en venstre sidebar: Overblik, Integrationer, Forbindelser, Aktivitet, Udvikler, Indstillinger og Abonnement. Topbjælken indeholder global søgning (⌘K), notifikationscenter, hjælp og brugermenu. Marketing, signup og pris ligger på www.agentor.dk. Intern drift og support ligger på manage.agentor.dk og er ikke en del af denne specifikation, bortset fra break-glass.

| Rute | Side | Rolle min. | PWA |
| --- | --- | --- | --- |
| `/login`, `/login/mfa`, `/forgot-password`, `/invite/[token]` | Autentificering | – | Ja |
| `/onboarding` | Første opsætning: virksomhed, plan, første flow | Ejer | Nej |
| `/` | Overblik (dashboard) | Læser | Ja (mobilvisning) |
| `/integrations` | Integrationer: udfoldelig tabel | Læser | Ja (status + handlinger) |
| `/integrations/new` | Skabelonvælger → editor | Admin | Nej |
| `/integrations/[id]` | Flowdetalje: Oversigt | Læser | Ja |
| `/integrations/[id]/editor` | Node-editor (kladde) | Admin / Udvikler | Nej ("Åbn på computer") |
| `/integrations/[id]/runs` | Kørsler og records for flowet | Læser | Ja |
| `/integrations/[id]/versions` | Versionshistorik og diff | Admin | Nej |
| `/connections`, `/connections/[id]` | Forbindelser: sundhed, genautentificering, hvilke flows der bruger dem | Admin | Kun status |
| `/activity`, `/activity/[runId]` | Samlet log på tværs af flows med filtre og CSV-eksport | Læser | Ja |
| `/activity/reconciliation` | Simpel afstemning pr. dag | Læser | Nej |
| `/developer/webhooks`, `/developer/api-keys` (fase 3), `/developer/logs` | Udgående webhooks, API-nøgler, rå logs | Udvikler | Nej |
| `/settings/company`, `/team`, `/notifications`, `/security`, `/audit-log` | Virksomhed, brugere og roller, notifikationer, MFA og sessioner, audit-log | Ejer/Admin (notifikationer: alle) | Notifikationer: ja |
| `/billing`, `/billing/usage`, `/billing/invoices` | Plan, forbrug af transaktioner og integrationssæt, fakturaer | Ejer | Kun forbrug |
| `/notifications` | Notifikationscenter (fuld side) | Læser | Ja |

### Roller (v1)

| Rolle | Må |
| --- | --- |
| **Ejer** | Alt, inkl. abonnement, sletning af konto og overdragelse af ejerskab. Mindst én pr. tenant. MFA er påkrævet. |
| **Admin** | Flows, forbindelser, team (undtagen ejere) og indstillinger. MFA er påkrævet. |
| **Udvikler** | Flows og forbindelser, avanceret mapping, rå logs og webhooks. Ingen team eller abonnement. |
| **Læser** | Læseadgang til overblik, integrationer og aktivitet. Egnet til bogholder eller revisor. |

### Adgang pr. integration

En bruger kan have adgang til alle flows eller kun til udvalgte flows. Det bruges til eksterne udviklere og bureauer, der kun skal arbejde på én integration.

- Begrænset adgang sættes ved invitation eller under Team: vælg rolle (Udvikler eller Læser) og vælg flows.
- En begrænset bruger ser kun de tildelte flows, deres kørsler og de forbindelser, flowene bruger (kun navn og status). Overblik og Aktivitet filtreres tilsvarende.
- Begrænsede brugere kan ikke oprette flows eller forbindelser. Adgangen kan tidsbegrænses (fx 30 dage) og udløber automatisk.
- Ejer og Admin har altid adgang til alle flows.

## 7. Sidespecifikationer

Hver side er beskrevet med formål, indhold og tilstande. Alle lister skal designes med tilstandene *tom*, *indlæser*, *fejl* og *ingen adgang*.

### 7.1 Status-vokabular (gælder hele app'en)

Status beregnes pr. **rute** og rulles op til flow og dashboard efter reglen *værste status vinder*. Undtagelsen er Pauset, som ikke tæller som fejl.

| Status | Betydning | Udløses af | Kundens næste handling |
| --- | --- | --- | --- |
| **Aktiv** | Kører uden fejl | Ingen fejl i de seneste 24 timer | – |
| **Advarsel** | Kører, men har enkelte fejl eller nærmer sig en grænse | Fejlrate under 5 %, rate limit over 80 % eller kvote over 80 % | Se fejl, gentag |
| **Fejl** | Records fejler systematisk | Fejlrate på 5 % eller mere, eller 3 fejl i træk | Åbn fejl, ret mapping, gentag |
| **Afbrudt** | Forbindelsen virker ikke | 401/403 fra systemet eller udløbet token | Genautentificér forbindelsen |
| **Pauset** | Stoppet af kunden, af systemet (kvote eller deprecation) eller af manglende betaling | Manuel handling eller system | Genoptag, opgradér |
| **Test** | Kører i dry-run eller kladdetilstand | Rutens tilstand | Skift til Live |
| **Kladde** | Flowet er aldrig publiceret | – | Gennemfør og publicér |

Status vises altid som **ikon + tekst**, aldrig kun farve. Grænserne (5 %, 3 fejl i træk, 80 %) er standarder, som kan justeres pr. tenant under Notifikationer.

### 7.2 Overblik (`/`)

**Formål:** Svar på "kører alt?" på under 3 sekunder.

- **Sundhedsbånd:** antal flows fordelt på Aktiv, Advarsel, Fejl, Afbrudt og Pauset. Klik filtrerer integrationstabellen.
- **Nøgletal (i dag, 7 dage, 30 dage):** synkroniseret omsætning (sum af ordrebeløb fra kilden, inkl./ekskl. moms efter valg), antal ordrer, records synkroniseret og fejlrate. Hvert tal har en lille trend.
- **Kræver handling:** prioriteret liste med afbrudte forbindelser, ruter med fejl og records, der venter på manuel godkendelse (Kladde-bogføring), med én primær knap pr. punkt.
- **Forbrug:** transaktioner denne måned i forhold til planen og integrationssæt brugt i forhold til planen, med opgraderingsknap ved 80 %.
- **Seneste aktivitet:** 10 seneste kørsler med link.

*Bemærk:* "Omsætning" er Agentors opgørelse af synkroniserede ordrer, ikke regnskabets tal. Dette skal stå i en tooltip for at undgå forveksling med bogført omsætning.

### 7.3 Integrationer (`/integrations`): udfoldelig tabel

**Formål:** Driftsoverblik over alle flows med mulighed for at handle direkte.

**Hovedrække (flow):** udfold-pil · navn · kilde-logo → destinationslogoer (maks. 4 + "+N") · samlet status · sidste kørsel (relativ tid) · records 24 t · fejl 24 t · tilstand (Live/Test-blanding) · handlinger (…): Pause/Genoptag alle, Kør nu, Åbn editor, Duplér, Slet.

**Underrækker (ruter), synlige ved udfoldning:** entitet → destination (fx "Kunder → HubSpot Kontakter") · status · tilstand · sidste kørsel · ok/fejl 24 t · mini-sparkline 7 dage · handlinger: Pause/Genoptag, Gentag fejlede, Åbn i editor (springer direkte til ruten i inspektøren), Se log.

**Værktøjslinje:** søgning, filtre (status, kilde, destination, entitet, tilstand), sortering, "Fold alle ud" og CTA'en **Nyt flow**. CTA'en er deaktiveret med forklaring og opgraderingslink, når planens grænse er nået. Filtre gemmes i URL'en, så en filtreret visning kan deles.

**Masseredigering:** vælg flere flows → Pause/Genoptag. Sletning sker kun én ad gangen og med navnebekræftelse.

**Tom tilstand:** tre skabelonkort (WooCommerce → Dinero, Shopify → e-conomic, Webshop → Regnskab + CRM) og "Start fra blankt".

### 7.4 Flowdetalje (`/integrations/[id]`)

Faner: **Oversigt · Editor · Kørsler · Versioner · Indstillinger.**

- **Oversigt:** skrivebeskyttet miniature af grafen (klik åbner editoren), ruterne som kort med status og nøgletal, "Kør nu", "Efterindlæs" og en forklaring i klartekst af, hvad flowet gør. Forklaringen genereres fra grafen: "Når en ordre i WooCommerce bliver Gennemført, oprettes en faktura i Dinero som kladde, og kunden opdateres i HubSpot."
- **Editor:** se afsnit 5.
- **Kørsler:** tidslinje over kørsler. Klik åbner records med kilde-id, destinations-id (med link til systemet), udfald og fejltekst. Udviklerlaget viser request/response.
- **Indstillinger:** navn, beskrivelse, ejer, notifikationsmodtagere for netop dette flow og farezonen (pause, slet). Ved sletning stoppes nye kørsler straks. Data bevares i 30 dage og slettes derefter.

### 7.5 Forbindelser (`/connections`)

Kortgrid eller tabel med logo, kontonavn (fx "645163 – DUCATI"), status, udløb af token, rate limit-forbrug og "bruges i N flows". Detaljesiden har **Gentest forbindelse**, **Genautentificér**, forbindelsesindstillinger fra manifestet og **Afbryd**. Afbryd advarer, hvis forbindelsen bruges i aktive flows. Nøgler vises aldrig, heller ikke maskeret. Der vises kun "Konfigureret 12. okt. af Mette".

### 7.6 Aktivitet (`/activity`)

Samlet, filtrerbar log over kørsler og records på tværs af flows. Der kan filtreres på flow, rute, entitet, udfald, datointerval og fritekst (ordrenummer, e-mail). Massé-handling: **Gentag valgte**. CSV-eksport respekterer filteret. En **Afstemning**-fane viser pr. dag antal og beløb for ordrer i kilden og fakturaer oprettet i ERP. Afvigelser markeres.

### 7.7 Udvikler (`/developer`)

- **Udgående webhooks:** abonnér på hændelser (`record.failed`, `run.completed`, `connection.broken`) med HMAC-signeret payload, gentagelse og leveringslog.
- **Logs:** rå request/response for de seneste 30 dage. PII er maskeret, med mulighed for at vise felter enkeltvis (handlingen audit-logges).
- **API-nøgler (fase 3):** scoped nøgler (læs eller skriv pr. ressource), vist én gang ved oprettelse.

### 7.8 Indstillinger og abonnement

- **Virksomhed:** navn, CVR, adresse, sprog (da/en), tidszone og valuta.
- **Team:** invitér, skift rolle, fjern, ventende invitationer.
- **Notifikationer:** matrix med hændelser (fejl, afbrudt forbindelse, kvote, betaling, connector-opdatering, "nyt tilgængeligt") × kanaler (in-app, e-mail, push, SMS for kritiske hændelser) samt tærskler og stilletid (fx 22–07).
- **Sikkerhed:** MFA (TOTP og passkeys), aktive sessioner med "log ud overalt" og krav om MFA for alle i organisationen.
- **Audit-log:** hvem gjorde hvad og hvornår. Viser også Agentor-supports break-glass-adgange. Kan filtreres og eksporteres.
- **Abonnement:** nuværende plan, sammenligning af Startup/Business/Enterprise, forbrug, betalingsmetode (QuickPay) og fakturaer. Nedgradering blokeres med klar vejledning, hvis kunden er over den nye plans grænse. Intet deaktiveres stiltiende.

### 7.9 Onboarding (`/onboarding`)

Tre trin: (1) bekræft virksomhed (CVR-opslag), sprog og tidszone, (2) vælg plan og betal, (3) vælg en skabelon, som åbnes i editoren med guiden aktiv. Målet er "første testkørsel gennemført". Det er aktiveringsmetrikken, og en tjekliste på Overblik følger den, indtil den er nået.

## 8. PWA og mobil

På mobil er app'en et overvågnings- og reaktionsværktøj. Den bruges ikke til konfiguration. Det er samme Next.js-app og samme ruter med responsiv visning, ikke en separat mobilapp.

| Kan på mobil | Kan ikke på mobil (viser "Åbn på computer" med link sendt pr. e-mail) |
| --- | --- |
| Overblik: sundhed, omsætning, ordrer, fejlrate, forbrug | Node-editor og mapping |
| Integrationer: liste med udfoldning, pause/genoptag, kør nu | Oprettelse og sletning af flows og forbindelser |
| Fejl: læs fejlforklaring, gentag record eller rute | Udviklerlog med rå payloads |
| Genautentificér forbindelse (OAuth-flow virker på mobil) | Team, sikkerhed og abonnement (bortset fra visning af forbrug) |
| Notifikationscenter og push-indstillinger | Afstemning og CSV-eksport |

**Mobilnavigation:** bundbjælke med Overblik, Integrationer, Aktivitet og Notifikationer.

**Push:** Web Push med VAPID-nøgler, sendt fra egen server uden tredjepart. Understøttet på Android og på iOS 16.4+, når PWA'en er installeret på hjemmeskærmen. Onboarding skal vise en installationsguide til iOS. Push-tekster må ikke indeholde persondata ("1 ordre fejlede i Dinero-flowet", ikke kundens navn).

**Caching og isolation:**

- Service workeren cacher kun app-skallen (statiske assets). API-svar caches aldrig i Cache Storage.
- Et "sidst kendte" status-snapshot (kun aggregater, ingen persondata) gemmes i IndexedDB nøglet på `user_id` og `tenant_id`. Det vises med tydeligt "Offline – data fra kl. 14:02".
- Ved logout, skift af bruger eller 401 slettes IndexedDB og push-abonnementet afmeldes. Dette dækkes af isolationstestsuiten.

## 9. Sikkerhed og tenant-isolering (revideret)

Platformen er i praksis en nøgleboks med skriveadgang til kundernes regnskab, webshop og CRM. Det er den reelle risiko, mere end data i Agentors egen database. Modellen er: delt database og delt skema med `tenant_id` på alle tenant-tabeller. Isoleringen håndhæves i tre uafhængige lag: applikation, database (RLS) og drift (OS-brugere, rettigheder og netværk). Hvert lag skal kunne svigte, uden at data lækker.

### 9.1 Datalaget: PostgreSQL Row-Level Security

- Alle tenant-tabeller har `tenant_id uuid NOT NULL`, som indgår først i sammensatte indeks, og får `ENABLE` + `FORCE ROW LEVEL SECURITY` med politikken `tenant_id = current_setting('app.tenant_id')::uuid` for både `USING` og `WITH CHECK`.
- Applikationen forbinder som en rolle **uden** `BYPASSRLS`, som ikke ejer tabellerne. Migrationer køres af en separat ejer-rolle, som ingen runtime-proces bruger.
- Hver request og hvert job kører i en transaktion, der starter med `SET LOCAL app.tenant_id = …`. `SET LOCAL` er obligatorisk og ikke `SET`, fordi connection pools ellers kan lække tenant-kontekst mellem requests. Mangler værdien, fejler politikken lukket: ingen rækker returneres.
- `TenantContext` udledes **kun** af den autentificerede session eller af jobbet, som revalideres mod forbindelsesrecordet. Den udledes aldrig af URL eller body. Ruter indeholder ikke tenant-id. Objekt-id'er er UUID v7. Adgang pr. integration håndhæves også i databasen: en ekstra RLS-politik på flows og afledte tabeller kræver adgang til alle flows eller en række i flow\_grants. app.user\_id sættes sammen med app.tenant\_id.
- Sammensatte fremmednøgler `(tenant_id, id)` gør det umuligt for databasen at koble et objekt til en anden tenants objekt.
- Repository-laget og en CI-lint, der forbyder rå SQL uden for repository-laget, bevares som første lag.

### 9.2 Nøgleboksen: forbindelses-credentials

- Credentials ligger i `connection_secrets` og krypteres med AES-256-GCM via envelope-kryptering: én data-nøgle (DEK) pr. tenant, krypteret med en master-nøgle (KEK).
- **KEK på Plesk-serveren:** en fil uden for webroot (fx `/``v``ar``/``w``w``w``/``v``h``osts``/``agentor``.``dk``/kek`), ejet af `agentor-worker` med mode 0400. Den er ikke læsbar for web-processens OS-bruger og findes ikke i repo, `.env` eller backups. Den sikkerhedskopieres separat og offline (to personer, papir/hardware-token). Nøgleadgang ligger bag et lille interface, så der kan skiftes til HashiCorp Vault eller cloud-KMS (EU-region) uden datamigrering. Bemærk: /var/www/vhosts/agentor.dk ejes af Plesk-abonnementets systembruger. KEK-filen og dens mappe skal derfor ejes af agentor-worker med mode 0400/0700, og Plesk-brugeren må ikke være i worker-gruppen. Ellers kan en kompromitteret web-proces læse nøglen.
- Kun worker-rollen i databasen har `SELECT` på `connection_secrets`. Web-rollen kan skrive nye hemmeligheder via en `SECURITY DEFINER`-funktion, som kun indsætter og aldrig returnerer. Web-processen kan altså gemme en nøgle, men ikke læse den.
- OAuth-scopes minimeres pr. connector. Der kræves ikke bredere adgang end entiteterne kræver.
- **Rotation:** KEK-rotation gen-krypterer kun DEK'er. Ved mistanke om kompromittering findes en runbook for at tilbagekalde tokens hos udbyderne (Shopify, Dinero, HubSpot) inden for 60 minutter.

### 9.3 Kø- og jobslaget

- Hvert job bærer `tenant_id` og `connection_id`. Workeren genlæser forbindelsen og verificerer ejerskab, før den sætter `app.tenant_id`.
- Job-payloads indeholder **referencer, ikke persondata**. Records hentes eller læses krypteret fra databasen. Så lækker et Redis-dump ingen kundedata.
- Retfærdighed: BullMQ (open source) har ikke grupper pr. tenant. Det klares med en token-bucket i Redis pr. forbindelse og pr. tenant. Jobs over grænsen udskydes (`moveToDelayed`). Alternativet er BullMQ Pro Groups, som kræver licens.

### 9.4 Webhooks og SSRF

- Indgående webhooks har en unik, uforudsigelig URL pr. forbindelse. HMAC-signaturen verificeres efter udbyderens specifikation med tidsstempel- og nonce-kontrol (afvises efter 5 min.). Endpointet kvitterer hurtigt og lægger hændelsen i kø, uden synkron behandling.
- Udgående kald (fx til kundens selvhostede WooCommerce) går gennem én HTTP-klient. Den kræver HTTPS, opløser DNS én gang og afviser private, loopback-, link-local- og metadata-adresser (også efter redirect). Den har timeouts og maks. svarstørrelse.
- Som ekstra lag på OS-niveau blokerer `iptables` med `owner`-match udgående trafik fra `agentor-worker` til private net, undtagen PostgreSQL og Redis via Unix-sockets.

### 9.5 Autentificering og sessioner

- Selv-hostet auth (anbefaling: Better Auth, alternativt Auth.js) med e-mail og adgangskode (Argon2id), TOTP og passkeys. MFA er påkrævet for Ejer og Admin.
- Sessioner gemmes server-side i en HttpOnly-, Secure- og SameSite=Lax-cookie med 12 timers inaktivitet og 30 dages absolut levetid. Der er rotation ved login og ved rolleændring.
- Rate limiting på login og MFA, lås efter gentagne fejl og notifikation ved login fra ny enhed.
- Sikkerheds-headere: streng CSP med nonce, HSTS, `frame-ancestors 'none'` og CSRF-beskyttelse på mutationer.

### 9.6 Persondata og logs (GDPR)

- **Dataklassifikation:** *Begrænset* (credentials), *Fortrolig* (kunde- og ordredata i records og payloads), *Intern* (konfiguration, metrikker).
- Payloads til fejlfinding krypteres med tenantens DEK og slettes automatisk efter 30 dage. Kørsels- og record-metadata uden persondata gemmes i 13 måneder. Audit-log gemmes i 24 måneder. Alle perioder kan konfigureres pr. plan.
- Applikationslogs maskerer e-mail, telefon, adresse og navn. Fejl-sporing (Sentry eller GlitchTip selvhostet i EU) får ingen payloads.
- Kunden kan eksportere alle sine data (JSON/CSV) og slette kontoen med 30 dages fortrydelse, derefter hård sletning. Databehandleraftale (DPA) og en liste over underdatabehandlere publiceres.

### 9.7 Support og break-glass

Agentor-medarbejdere har ingen stående adgang til tenant-data. Support sker på kundens anmodning. Adgang anmodes i manage.agentor.dk med sag og begrundelse og gælder i højst 60 minutter. Support kan se data og udføre de samme handlinger som en Admin (gentag, pause, ret mapping) for at hjælpe kunden. Support kan aldrig se nøgler eller ændre team og abonnement. Adgangen sker via en dedikeret databaserolle, som kun virker gennem audit-loggede funktioner. Hver handling vises i kundens audit-log med supportmedarbejderens navn. Kunden kan vælge, at adgang kræver godkendelse (D8).

### 9.8 Verifikation

- **Isolationstestsuite (blokerer merge):** For hver tenant-tabel og hvert endpoint oprettes to tenants. Testen tjekker, at A aldrig kan læse, ændre eller udlede B's data (404, ikke 403). Desuden køres en test direkte mod databasen uden `app.tenant_id`, som skal returnere 0 rækker.
- **CI-gates:** dependency-scanning (npm audit/Snyk), secret-scanning (gitleaks), SAST (Semgrep), låste lockfiles og migrationstjek af RLS (en ny tabel uden politik fejler bygget).
- Ekstern pentest før lancering og derefter årligt. Restore-øvelse hvert kvartal.

### 9.9 Residualrisiko: delt Plesk-server

V1 deler VM med andre websites. En kompromittering af et naboprojekt kan blive til root på serveren og dermed adgang til KEK og database. Det kan kun afbødes, ikke fjernes, på en delt server. Afbødning: separate OS-brugere uden shell, ingen PHP/Passenger på Agentors domæner, automatiske sikkerhedsopdateringer, fail2ban, SSH kun med nøgle og AppArmor-profiler for Node-processerne. **Exit-kriterie:** flyt til dedikeret VM (eller to: app og database) ved første betalende kunde over Business-niveau, ved 50 tenants eller før en kunde kræver ISO 27001/SOC 2-dokumentation. Det, der kommer først, gælder.

## 10. Teknisk arkitektur og drift

V1 kører som fire PM2-processer under to OS-brugere bag Plesk-styret Nginx. Der bruges samme driftsmønster som agentor.dk (PM2 som eneste procesmanager, Plesks Node.js-hosting slået fra). PostgreSQL og en dedikeret Redis-instans kører lokalt og nås kun via Unix-sockets.

&#91;embedded content: Driftsarkitektur v1 · 4 processer, 2 OS-brugere, 1 VM\]

Web-processerne skriver til database og kø, men kan ikke læse nøgler. Kun `agentor-worker` har KEK-filen og taler med kundernes systemer, og den udgående trafik er filtreret.

### 10.1 Processer

| Proces (PM2) | OS-bruger | Ansvar | Bemærkning |
| --- | --- | --- | --- |
| `agentor-app` | `agentor-web` | Next.js (App Router): UI, server actions og interne API-ruter | Ingen adgang til KEK eller `connection_secrets` |
| `agentor-ingest` | `agentor-web` | Let Fastify-tjeneste til indgående webhooks: verificér, kølæg, svar 200 | Isoleret, så en webhook-storm ikke rammer UI'et |
| `agentor-worker` | `agentor-worker` | BullMQ-workers: hent, normalisér, fan-out, skriv. Skal kunne skaleres til N instanser. | Eneste proces med KEK. Udgående trafik er filtreret. |
| `agentor-scheduler` | `agentor-worker` | Polling-planer, token-fornyelse, oprydning efter opbevaringsperioder, kvote-nulstilling, månedlig QuickPay-opkrævning | Præcis én instans (leder-lås i Redis) |

### 10.2 Stack

| Lag | Valg | Note |
| --- | --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind v4, shadcn/ui, TanStack Query og Table, React Hook Form + Zod, next-intl | Samme major-versioner som agentor.dk. Delte design tokens. |
| Flow-editor | `@xyflow/react` + ELK.js til auto-layout | MIT-licens |
| Grafer | Recharts eller Tremor (bygget på Recharts) | Overblik og sparklines |
| Backend | Node.js 22 LTS, Fastify (ingest), Drizzle ORM | Drizzle understøtter transaktions-scoped `SET LOCAL` rent |
| Mapping-udtryk | JSONata | Sandboxed, ingen vilkårlig kode, kører i worker med timeout |
| Kø | BullMQ på dedikeret Redis 7 (`noeviction`, AOF) | **Ikke** den delte Redis. Dens evictionspolitik kan slette jobs. |
| Database | PostgreSQL 16+ | RLS, `pg_stat_statements`, PITR via WAL-arkiv |
| Auth | Better Auth | Selv-hostet |
| E-mail | Brevo SMTP / SMS Gateway | Brevo (EU) til transaktionsmails og SMS-alarmer. Brevo er underdatabehandler. SPF/DKIM/DMARC på agentor.dk. |
| Observability | Pino (struktureret JSON med `tenant_id`), Prometheus node- og app-metrikker, Grafana, GlitchTip eller Sentry EU, Uptime Kuma | Selv-hostet hvor muligt |

### 10.3 Database-roller

| Rolle | Rettigheder |
| --- | --- |
| `agentor_owner` | Ejer skemaet. Bruges kun af migrationer i deploy-pipeline. |
| `agentor_web` | CRUD på tenant-tabeller under RLS. Ingen `SELECT` på `connection_secrets`. Kun indsatsfunktion. |
| `agentor_worker` | CRUD under RLS plus `SELECT` på `connection_secrets` |
| `agentor_support` | Ingen tabelrettigheder. Kun `EXECUTE` på audit-loggede break-glass-funktioner. |
| `agentor_readonly_ops` | Kun aggregater og metrikker uden RLS-tabeller (til Grafana) |

### 10.4 Robusthed i sync-motoren

- **Idempotens:** hver hændelse får nøglen `(connection_id, entitet, kilde-id, kildeversion/updated_at)`. Dubletter fra webhook-gentagelser ignoreres.
- **Krydsreferencer:** `entity_links` holder kilde-id ↔ destinations-id pr. rute. Det giver opdatering i stedet for dubletter og sporbarhed i UI.
- **Gentagelse:** eksponentiel backoff med jitter (1 min. → 6 t, maks. 8 forsøg). Ikke-genoprettelige fejl (valideringsfejl 4xx) gentages ikke automatisk og går direkte til "kræver handling".
- **Dead-letter:** opbrugte jobs bliver til fejlede records i UI'et med "Gentag". De forsvinder ikke i Redis.
- **Polling-sikkerhed:** cursor (sidste `updated_at` og id) gemmes pr. rute. Der er overlap-vindue på 2 minutter og idempotens.
- **Graceful deploy:** workers stopper med at tage nye jobs, færdiggør aktive jobs (timeout 60 s) og genstarter. Databasemigrationer følger expand-contract-mønstret.

### 10.5 Miljøer og deploy

- **Miljøer:** `dev` (Docker Compose lokalt: Postgres, Redis, Mailpit), `staging` (staging.app.agentor.dk på samme VM, separat database, Redis-DB og OS-bruger) og `prod`.
- **Deploy:** GitHub Actions bygger og tester (inkl. isolationssuite). Deploy sker via SSH-nøgle til en begrænset deploy-bruger: `git pull` → `npm ci` → migrér (`agentor_owner`) → build → `pm2 reload`. Releases ligger i versionerede mapper med symlink, så rollback er ét symlink-skift.
- **Hemmeligheder:** `.env.production` uden for webroot med mode 0400 pr. OS-bruger. KEK ligger i separat fil (afsnit 9.2). Produktionsadgangskoden til databasen fra agentor.dk-overdragelsen skal roteres, da den har været delt i en chat.

### 10.6 Backup og genopretning

- `pgBackRest` (eller `pg_basebackup` + WAL-arkiv) til krypteret EU-objektlager, fx Hetzner Storage Box eller Scaleway. Full backup ugentligt, differentiel dagligt, kontinuerlig WAL.
- **RPO 15 minutter, RTO 4 timer** for v1. Restore testes kvartalsvis og dokumenteres.
- Redis (AOF) sikkerhedskopieres dagligt. Ved tab genopbygges køen fra databasen (polling-cursors og ventende records), så Redis ikke er kilden til sandhed.

### 10.7 Kapacitet og overvågning

Alarmer (til Agentor-drift, ikke kunder): kø-alder på over 5 minutter, fejlrate pr. connector over 10 %, disk over 80 %, replikering eller WAL-arkiv fejler, certifikatudløb under 14 dage og mange 404'er på tværs af tenants fra samme session (signaturen på IDOR-sondering). En offentlig statusside (status.agentor.dk) fødes fra Uptime Kuma.

## 11. Datamodel

Alle tabeller markeret med RLS har `tenant_id`, sammensat primær- og fremmednøgle-disciplin og FORCE RLS. Globale tabeller (katalog og planer) er skrivebeskyttede for runtime-roller.

| Tabel | RLS | Indhold | Noter |
| --- | --- | --- | --- |
| `tenants` | – (egen politik: `id = app.tenant_id`) | Virksomhed, CVR, sprog, tidszone, valuta, status |  |
| `users`, `memberships` | ja (memberships) | Bruger (global identitet), rolle pr. tenant og adgangsomfang (alle flows eller udvalgte). Udvalgte flows ligger i flow\_grants (RLS) med valgfri udløbsdato. | Klar til at én bruger kan være i flere tenants, fx et bureau |
| `auth_sessions`, `auth_factors`, `invitations` | ja | Sessioner, MFA-faktorer, invitationer | Ejet af auth-biblioteket, udvidet med `tenant_id` |
| `plans`, `plan_entitlements` | global | Startup, Business, Enterprise som data: integrationssæt, transaktioner, pollinginterval, opbevaring, rate limit | Ingen planlogik i kode |
| `subscriptions`, `addons`, `usage_counters` | ja | Abonnementsstatus, tilkøb og månedligt forbrug (transaktioner) | Entitlement-guard læser ét samlet view |
| `connectors`, `connector_versions` | global | Katalog og manifester |  |
| `connections` | ja | Kundens konti: connector, version, navn, status, sundhed, webhook-sti |  |
| `connection_secrets` | ja + kun worker-SELECT | Krypterede credentials og krypteret DEK-reference | Afsnit 9.2 |
| `tenant_keys` | ja + kun worker-SELECT | DEK pr. tenant, krypteret med KEK |  |
| `flows` | ja | Navn, status, publiceret version, kladdelås |  |
| `flow_versions` | ja | Uforanderlig graf (JSONB: noder, ruter, indstillinger, mapping), valideringsresultat, publiceret af og tidspunkt | Kladde = seneste upublicerede |
| `routes` (materialiseret) | ja | Denormaliseret pr. publiceret rute: entitet, destination, tilstand, aktiv | Til hurtig fan-out og statusrollup |
| `route_cursors` | ja | Polling-cursor pr. rute |  |
| `entity_links` | ja | Kilde-id ↔ destinations-id pr. rute, hash af sidste skrevne indhold | Unik pr. (route, kilde-id) |
| `runs` | ja | Kørsel: rute, trigger, start, slut, antal ok/fejl/sprunget over | Partitioneret pr. måned |
| `run_records` | ja | Record-udfald, kilde-id, destinations-id, fejlkode, menneskelig fejltekst | Partitioneret pr. måned, 13 mdr. |
| `run_payloads` | ja | Krypteret request/response til fejlfinding | Slettes efter 30 dage |
| `metrics_daily` | ja | Aggregater pr. dag og rute: antal, beløb, fejl | Driver Overblik og PWA |
| `notifications`, `notification_prefs`, `push_subscriptions` | ja | In-app-notifikationer, præferencer, Web Push-endpoints |  |
| `outbound_webhooks`, `webhook_deliveries` | ja | Kundens udgående webhooks og leveringslog | Hemmelighed krypteret |
| `audit_log` | ja (kun insert og select) | Aktør, handling, objekt, før/efter (uden hemmeligheder), IP, tidspunkt | Append-only, 24 mdr. |
| `support_access_grants` | ja | Break-glass: sag, begrundelse, udløb, godkendt af | Synlig for kunden |
| `feature_flags` | global + pr. tenant | Udrulning af connectors og funktioner pr. tenant |  |

**Flowgrafen gemmes som JSONB i `flow_versions`.** Det er bevidst. Grafen redigeres som én helhed, versioneres som snapshot og valideres med et delt Zod-skema. `routes` materialiseres ved publicering, så motoren og statusvisningen ikke skal parse JSON ved hver hændelse.

## 12. Ikke-funktionelle krav

| Område | Krav v1 |
| --- | --- |
| Ydelse (UI) | Overblik og integrationstabel: LCP under 1,5 s på desktop og under 2,5 s på 4G. Interaktion under 100 ms. Tabeller virtualiseres over 100 rækker. |
| Ydelse (sync) | Webhook til skrivning i destination: p95 under 60 s ved normal belastning. Polling efter plan (Startup 15 min., Business 5 min., Enterprise 1 min.; foreslået, se afsnit 14). |
| Kapacitet | Dimensioneret til 200 tenants og 50.000 records/dag på én VM. Workers skal kunne skaleres horisontalt uden kodeændringer. |
| Oppetid | Mål 99,5 % månedligt for UI og ingest (enkelt VM). Sync-hændelser må ikke tabes ved nedetid: webhook-udbydere gentager, og polling indhenter. |
| Tilgængelighed | WCAG 2.2 AA. Fuld tastaturbetjening (listevisning af editor). Fokusmarkering. Kontrast ≥ 4,5:1, også på lime (tekst på lime skal være #1A1A18). Status ikke kun med farve. `prefers-reduced-motion`. |
| Sprog | Dansk (standard) og engelsk fra dag 1 via next-intl. Alle tekster i nøglefiler. Datoer, tal og valuta i brugerens locale (da-DK: 1.234,50 kr.). Klar til tysk og svensk. |
| Browsere | Seneste 2 versioner af Chrome, Edge, Firefox og Safari. iOS Safari 16.4+ til push. Minimum desktop-bredde for editoren er 1280 px, men udgangspunkt er 1440px for størstedelen af brugere. |
| Datalokation | Al data og alle underdatabehandlere i EU/EØS. Ingen amerikanske SaaS-afhængigheder i datastien. |
| Sporbarhed | Hver record kan spores fra kilde-id via kørsel og rute til destinations-id. Hver konfigurationsændring findes i audit-loggen. |
| Vedligehold | Connectors følger kontrakttest mod sandbox-konti (Dinero, e-conomic, Shopify dev store, WooCommerce i Docker) i CI. |

## 13. Designbrief til Claude Design

Den bindende, detaljerede version ligger i Agentor App — Designspecifikation v1 sammen med startprompten til Claude Design. Afsnittet her er en opsummering. App'en skal tydeligt være Agentor: lime, navy, Plus Jakarta Sans, pills og bløde kort. Den skal samtidig være et tæt arbejdsværktøj. Det eksisterende designsystem (*Design System – Agentor Web*) er skrevet til marketingsitet. App-skallen er bevidst "pulled pending rework". Briefen definerer derfor de app-specifikke tilpasninger. Alt andet følger BRAND-CONTINUITY og DESIGN-RULES.

### 13.1 Arv fra brandet (uændret)

- Farver: `--color-primary #D0E84A`, `--color-dark #1A1A18`, `--color-fg-2 #6B6B67`, `--color-fg-3 #9B9B97`, `--color-secondary-navy #13293A`, `--color-border #E4E1DB`, `--color-bg-base #F0EDE8`.
- Typografi: Plus Jakarta Sans, vægte 400–800. Ikoner: kun Lucide 0.460 (stroke).
- Radier 8/16/20/28/fuld. Skygger: `--shadow-card` og `--shadow-sm`. 4 px-grid.
- Logo: Ordmærket Agentor med understreget "or".
- Alle farver, radier og afstande via tokens, så white-label senere kun kræver `--tenant-*`-overrides.

### 13.2 App-tilpasninger

| Regel på web | Forslag i app | Begrundelse |
| --- | --- | --- |
| Siden er altid hvid | Lys canvas `--color-bg-base` bag hvide arbejdsflader. Lærredet i editoren får et diskret prikgrid. | Adskiller navigation, arbejdsflade og paneler i en tæt UI |
| Ingen semantiske rød/grønne farver | Fire nye statustokens: `--status-ok`, `--status-warn`, `--status-error`, `--status-info` (dæmpede, AA-kontrast), altid med ikon og tekst | Driftsstatus er kerneinformation. Lime forbliver brandets accent og primærhandling, ikke "ok". |
| Knapper altid UPPERCASE og pill | Primære CTA'er beholder UPPERCASE og pill. Sekundære og tætte knapper i tabeller og inspektør bruger *sentence case*, 13 px/600, højde 32 px, stadig pill. | UPPERCASE i hver tabelrække er støjende og tager plads |
| Ingen borders på kort | Tabeller og inputs må bruge 1 px `--color-border`. Kort beholder skygge uden border. | Datatabeller kræver linjer |
| Typeskala til marketing (72/44/40) | App-skala: 28/600 sidetitel, 20/600 sektion, 16/600 korttitel, 14/400 brødtekst, 13 tabel, 12 metadata. Stat-tal 32–40/700. | Tæthed. Den store 60 px-stat bruges kun på Overblik-kortene. |
| Header 88 px, ingen sidebar | Venstre sidebar 240 px (foldes til 64 px ikoner), topbjælke 56 px, inspektør 440 px | Standard app-skal |

### 13.3 Komponenter, der skal designes

| Komponent | Varianter og tilstande |
| --- | --- |
| App-skal | Sidebar (fuld/foldet, aktiv), topbjælke med ⌘K, notifikationsbadge og bruger/tenant-menu. Mobil: bundnavigation. |
| Statuspill og -prik | Aktiv, Advarsel, Fejl, Afbrudt, Pauset, Test, Kladde |
| Kørselstilstand-mærke | Test, Kladde, Live |
| Udfoldelig datatabel | Hovedrække og underrækker, valg, hover-handlinger, sticky header, filterchips, tom/indlæser/fejl, tæthed komfortabel/kompakt |
| Stat-kort | Tal, enhed, label, trend og sparkline. Lime- og hvid variant. |
| Connector-logo | 24/32/48 px, rundet firkant, fallback med initialer |
| Node | Kilde og destination: header (logo, navn, sundhed), porte pr. entitet (forbundet/ledig/ukompatibel under træk), valideringsmarkør, opdatering tilgængelig, valgt |
| Rute (kant) | Label med entitet og tilstand, status (farve + ikon midt på kanten), valgt, animeret flow ved aktiv kørsel (respekterer reduced motion), afhængighedsmærke |
| Inspektørpanel | Faner, formularsektioner genereret fra JSON Schema, "Avanceret"-sektion der kan foldes ud, sticky gem/annullér |
| Mapping-tabel | Kildefelt → målfelt, opslag (konto, moms), udtryk med preview, krævede felter, kategori → konto med produktundtagelser |
| Filterbygger | Felt, operator, værdi, OG/ELLER-grupper |
| Diff-visning | Versionssammenligning: tilføjet/ændret/fjernet pr. rute og indstilling |
| Fejlkort | Hvad, hvorfor, næste handling, "Gentag", "Vis detaljer" (udvikler) |
| Notifikation | In-app-toast, notifikationscenter, push-preview |
| Bekræftelsesdialog | Standard, destruktiv med indtastning af navn, "Gå Live"-bekræftelse |
| Tomme tilstande | Med skabelonkort |

### 13.4 Skærme til første designrunde (prioriteret)

1. Overblik: desktop og mobil (PWA), både "alt kører" og "2 fejl og 1 afbrudt forbindelse".
2. Integrationer: udfoldelig tabel med 6 flows, ét udfoldet med 4 ruter i blandet status. Mobilvisning.
3. Flow-editor: WooCommerce → Dinero + HubSpot + Brevo, rute "Ordrer → Dinero Fakturaer" valgt med Mapping-fanen åben. Vis også træk-tilstand og en valideringsfejl.
4. Flow-editor: skabelonvælger og guide i inspektøren.
5. Testkørsel og publicér: bundpanel med resultater og diff-dialog med "Gå Live".
6. Flowdetalje → Kørsler → record med fejl (forretnings- og udviklervisning).
7. Forbindelser: liste og detalje med "Afbrudt – genautentificér".
8. Aktivitet med filtre og afstemningsfane.
9. Indstillinger: notifikationsmatrix og sikkerhed (MFA).
10. Abonnement og forbrug, onboarding (3 trin) og login med MFA.

### 13.5 Eksempeldata til mockups

Brug realistiske, fiktive danske data: virksomheden "Nordlys Cykler ApS", WooCommerce-butik `shop.nordlys-cykler.dk`, Dinero-konto "Nordlys Cykler", ordrenumre #10421–#10460, beløb i DKK og danske kontonumre (1000 Salg, 1010 Salg EU, 1100 Fragt). Brug ikke rigtige kunders navne eller konti.

## 14. Faseplan, risici og åbne beslutninger

Byggeriet er delt i fem faser med en gate mellem hver. Sikkerhedsfundamentet (RLS, nøgleboks og isolationssuite) leveres i fase 1, ikke senere. Varigheder estimeres, når specifikationen er godkendt.

### 14.1 Faser

| Fase | Indhold | Gate (kriterie for at gå videre) |
| --- | --- | --- |
| **0 – Fundament** | Hærdning af VM, OS-brugere, PostgreSQL med roller og RLS, dedikeret Redis, CI/CD med gates, backup og restore-test, staging | Restore-test bestået. Isolationssuite kører i CI. |
| **1 – Platform** | Auth og MFA, tenants og team, onboarding, abonnement og entitlements, app-skal, Overblik, integrationstabel, forbindelser, flow-editor med kladde, validering og versioner, connector-SDK og manifest, audit-log | Editoren kan bygge og publicere et flow mod en mock-connector. |
| **2 – Første live-integration** | WooCommerce → Dinero: kunder, produkter, ordrer → fakturaer og kreditnotaer, Dinero-indstillinger, kategori → konto, moms i tre niveauer, Test/Kladde/Live, fejl og gentag, notifikationer og push, PWA | 3 pilotkunder i Live i 30 dage med mindst 99 % records uden indgriben. Ekstern pentest bestået. |
| **3 – Bredde og fan-out** | Shopify, e-conomic, HubSpot, Brevo, Mailchimp, udgående webhooks, afstemning, efterindlæsning | Shopify og e-conomic tilføjet uden ændringer i motorens kerne (kontrakttest af connector-SDK'et) |
| **4 – Udvikler og vækst** | Offentligt API, generisk HTTP-connector, Router-node, AI-mappingforslag (foreslå og bekræft), SSO, flytning til dedikeret VM | Efter efterspørgsel |

### 14.2 Risici

| Risiko | Sandsynlighed | Konsekvens | Afbødning |
| --- | --- | --- | --- |
| Kompromittering af delt Plesk-server | Lav–mellem | Kritisk: nøgler til kunders ERP | Afsnit 9.9 og exit-kriterie for dedikeret VM |
| e-conomics ordre/faktura-API til skrivning er markeret eksperimentelt | Mellem | Fase 3 forsinkes | Bekræft status hos Visma før fase 3. Kladde som standard. |
| Node-editoren bliver for kompleks for forretningsejeren | Mellem | Lav aktivering | Skabeloner og guide i editoren, klartekst-forklaring af flowet, brugertest med 5 kunder før fase 2 |
| Fan-out giver dubletter og loops (fx CRM ↔ ERP) | Mellem | Forkerte data hos kunden | `entity_links`, idempotens, ekko-undertrykkelse, én kilde pr. flow |
| Rate limits hos destinationer ved efterindlæsning | Høj | Langsom import, fejl | Token-bucket pr. forbindelse, efterindlæsning med lav prioritet |
| Prisstruktur (integrationssæt og transaktioner) passer ikke til fan-out | Mellem | Utilfredse kunder eller tabt omsætning | Beslut definition før fase 1 (D1 og D2) |

### 14.3 Beslutninger (godkendt 18. okt. 2026)

| # | Beslutning | Beslutning |
| --- | --- | --- |
| D1 | Hvad er ét "integrationssæt"? | 1 flow med 1 kilde og op til 3 destinationer. Flere destinationer kræver Enterprise. |
| D2 | Hvad tæller som én "transaktion", og hvad sker der ved overskridelse? | Succesfuld Live-skrivning pr. destination. Ved 100 % fortsætter driften i 7 dage med varsel og derefter mod tilkøb. Driften pauses ikke stiltiende. |
| D3 | Planernavne og indhold: agentor.dk siger Startup/Business/Enterprise (1/2/alle sæt), mens SPECIFICATION.md siger Startup/SME/SOHO (2/4/alle) | Følg agentor.dk og ret SPECIFICATION.md |
| D4 | Betaling: QuickPay blev fjernet fra websitet. Hvilken betalingsløsning og fakturering bruger app'en? | QuickPay-abonnementer. Månedlig opkrævning startes af agentor-scheduler. |
| D5 | Godkendelse af app-undtagelser fra DESIGN-RULES (afsnit 13.2) | Godkendt (alle fem). |
| D6 | Auth-bibliotek | Better Auth. Det er open source (MIT) og gratis, med organisationer, TOTP og passkeys indbygget. |
| D7 | Pollinginterval pr. plan | 15/5/1 min. |
| D8 | Skal kunden kunne kræve godkendelse af Agentors break-glass-adgang? | Ja, som valgfri indstilling. |
| D9 | Skal bureauer kunne have flere kundekonti under ét login? | Datamodellen understøtter det fra v1 (memberships). UI til tenant-skift kommer i fase 3. |

- [x] D1–D9 besluttet
- [x] Specifikation godkendt
- [ ] Designrunde 1 bestilt i Claude Design (skærme fra afsnit 13.4)
