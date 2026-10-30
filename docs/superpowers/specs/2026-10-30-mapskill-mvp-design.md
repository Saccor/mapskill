# Mapskill MVP: design

Datum: 2026-10-30
Status: utkast för granskning
Underlag: [research-sammanstallning.md](../../../research-sammanstallning.md)

---

## 0. Beslut som fattats i designen (ändra här om du vill annorlunda)

| # | Beslut | Valt | Varför | Alternativ |
|---|---|---|---|---|
| B1 | Form | Claude Code-plugin + lokal kartvy i webbläsaren | Lever där vibekodaren redan jobbar; hooks ger liveuppdatering och kan styra agenten | VS Code-tillägg, fristående skrivbordsapp |
| B2 | Första stack | Next.js (App Router) + TypeScript, med Supabase eller Prisma som databas | Vanligaste stacken som AI-verktyg genererar; ramverkskonventioner gör det möjligt att visa "sidor" och "API-rutter" | Vite + React (Lovables stack) kommer som adapter nummer två |
| B3 | Parsning | TypeScripts egen parser (`ts.createSourceFile`) + `ts.resolveModuleName` | Ren JavaScript, inga native-beroenden att kompilera på Windows, löser `@/`-alias korrekt | tree-sitter (rapportens förslag) läggs bakom ett gränssnitt för senare språk |
| B4 | Lagring | Graf i minnet + JSON-cache i `.mapskill/` | Nybörjarrepon är små; ingen databas att installera | SQLite när repon blir stora |
| B5 | LLM | Ingen LLM i Mapskill själv | Inga kostnader, ingen kod lämnar datorn, inga hallucinerade kartor. Förklaringar och ändringar görs av Claude i användarens egen session | Egen LLM för etiketter senare |
| B6 | Språk i gränssnittet | Engelska som standard, svenska som andra språk via översättningsfil | Bredast publik, men användaren och första testarna är svenska | Endast svenska |
| B7 | Licens | MIT, öppen källkod | Förtroende (kod lämnar aldrig datorn) och spridning; hobbyister betalar inte | Öppen kärna + betald Pro senare |
| B8 | Dra-och-bygg | Ingår **inte** fullt. Endast "spöknoder" och en Bygg-knapp per nod | Rapporten: bevisa att folk återvänder till kartan först | Kanvas-till-spec i fas 2 |

Arbetsnamn: **Mapskill**.

---

## 1. Mål och icke-mål

### Mål

1. En nybörjare som vibekodar en Next.js-app i Claude Code ser hela appen som en karta av saker hen känner igen: sidor, API-rutter, komponenter, databastabeller, externa tjänster och delade hjälpfunktioner.
2. Kartan uppdateras inom två sekunder efter att Claude (eller användaren) ändrat en fil, och visar var Claude just har varit.
3. Mapskill upptäcker dubbletter, oanvänd kod, för krånglig kod och strukturbrott, och visar dem på klarspråk som frågor.
4. Claude får samma fynd automatiskt innan den avslutar ett varv, och uppmanas att återanvända befintlig kod i stället för att skriva nya snabblösningar.
5. Användaren kan styra Claude direkt från kartan: låsa delar som är klara, be om förklaring, och begära nya delar.
6. Användaren kan välja ett mål ("webbapp med inloggning", "SaaS med betalning") och se vad som saknas som streckade spöknoder.
7. Allt körs lokalt. Ingen kod lämnar datorn. Inga API-nycklar behövs.

### Icke-mål i MVP

- Andra språk eller ramverk än Next.js/TypeScript.
- Fri ritning av arkitektur som kompileras till kod.
- Automatiska omskrivningar. Mapskill ändrar aldrig användarens kod själv.
- Molntjänst, konton, team-funktioner, CI-integration.
- Semantisk dubblettdetektion med embeddings.
- Stöd för Cursor eller andra agenter. MCP-servern fungerar tekniskt där, men hooks och testning görs bara för Claude Code.

---

## 2. Kärnloopen

```
Användaren skriver till Claude: "lägg till en profilsida"
        |
Claude redigerar filer  ──> PostToolUse-hook meddelar Mapskill vilka filer som ändrades
        |                             |
        |                    Mapskill parsar om filerna, uppdaterar grafen,
        |                    kör analyser, pushar ändringen till kartan
        |                             |
        |                    Kartan: ny nod "Profil" pulserar,
        |                    gul prick på "formatDate2" (liknar formatDate)
        |
Claude försöker avsluta ──> Stop-hook frågar Mapskill om nya fynd
        |                             |
        |                    "Du skapade formatDate2 i app/profile/utils.ts.
        |                     lib/date.ts:formatDate är nästan identisk.
        |                     Återanvänd den om det går."
        |
Claude rättar sig själv och avslutar
        |
Användaren tittar på kartan, klickar "Betalning" -> Lås
        |
Nästa gång Claude försöker ändra en låst fil ──> PreToolUse-hook stoppar ändringen
                                                 med förklaring
```

Det viktiga: användaren behöver inte förstå koden för att få nytta. Skyddsräcket fungerar via Claude även om kartan är stängd. Kartan är där användaren förstår och styr.

---

## 3. Begreppsmodell

### 3.1 Noder (det användaren ser)

| Nodtyp | Ikon | Hur den upptäcks i Next.js | Exempel på klarspråk |
|---|---|---|---|
| Sida | dokument | `app/**/page.tsx` | "Sidan /profile" |
| Layout | ram | `app/**/layout.tsx` | "Ramen runt alla sidor under /dashboard" |
| API-rutt | blixt | `app/**/route.ts`, `pages/api/**` | "API: POST /api/checkout" |
| Serveråtgärd | kugghjul | fil eller funktion med `"use server"` | "Serverfunktion: saveProfile" |
| Komponent | pussel | exporterad funktion som returnerar JSX, utanför `app/**/page` | "Komponent: ProfileCard" |
| Hjälpfunktion | verktyg | exporterad funktion utan JSX i `lib/`, `utils/` eller liknande | "Hjälpfunktion: formatDate" |
| Tabell | databas | `supabase.from('x')`, Prisma-modeller i `schema.prisma`, SQL-migreringar | "Tabell: profiles" |
| Extern tjänst | moln | import av känt SDK (Stripe, OpenAI, Resend, Clerk, Supabase auth m.fl.) | "Extern tjänst: Stripe" |
| Test | bock | `*.test.ts(x)`, `*.spec.ts(x)`, `tests/**` | "Test för formatDate" |
| Konfiguration | skiftnyckel | `next.config.*`, `.env*`, `middleware.ts` | "Middleware: körs före varje sida" |
| Spöknod | streckad | finns i vald mall men inte i koden | "Saknas: inloggningssida" |

En **fil** kan innehålla flera noder (en komponentfil med två exporterade komponenter). Varje nod pekar på fil och radintervall.

### 3.2 Zoner (de stora ytorna på kartan)

| Zon | Innehåll |
|---|---|
| Sidor | Sidor, layouter |
| Byggstenar | Komponenter |
| Server | API-rutter, serveråtgärder, middleware |
| Data | Tabeller |
| Delat | Hjälpfunktioner |
| Utanför | Externa tjänster |
| Tester | Tester (hopfällt som standard) |

Zoner är fasta i MVP. Användaren kan inte skapa egna.

### 3.3 Kanter

| Kant | Betydelse | Upptäcks via |
|---|---|---|
| använder | A importerar och använder B | importer |
| anropar | sida eller komponent anropar API-rutt | `fetch('/api/x')`-strängar matchade mot rutter |
| läser/skriver | kod rör en tabell | `supabase.from('x').select/insert/update/delete`, `prisma.x.findMany/create/...` |
| pratar med | kod använder extern tjänst | import av SDK |
| testar | test täcker nod | import från testfil |

### 3.4 Fynd (findings)

Varje fynd har: typ, säkerhet (`säker` eller `trolig`), berörda noder, en fråga på klarspråk, och en färdig instruktion till Claude.

| Fyndtyp | Säkerhet | Regel | Fråga som visas |
|---|---|---|---|
| Exakt dubblett | säker | två funktionskroppar identiska efter normalisering av blanksteg och kommentarer, minst 5 satser | "Dessa två gör exakt samma sak. Behövs båda?" |
| Omdöpt dubblett | säker | identiska efter att variabelnamn och litteraler ersatts med platshållare, minst 5 satser | "Dessa två är samma kod med olika namn. Slå ihop?" |
| Nästan-dubblett | trolig | Jaccard-likhet på 5-tokens-shingles minst 0,8 för funktioner med minst 8 satser | "Dessa liknar varandra mycket. Kan de bli en?" |
| Oanvänd export | säker | exporterad symbol som ingen importerar, och som inte är en Next.js-konvention (`default` i page/layout/route, `metadata`, `generateMetadata`, HTTP-metodnamn i route m.fl.) | "Ingen använder ProfileCardOld. Ska den bort?" |
| Föräldralös fil | säker | fil som inte nås från någon ingångspunkt (sidor, rutter, middleware, config, tester) | "Den här filen används inte någonstans." |
| Krånglig funktion | trolig | kognitiv komplexitet över 15 eller djupare nästling än 4 | "Den här funktionen är svår att följa. Dela upp?" |
| Lång fil | trolig | över 400 rader | "Den här filen gör många saker." |
| Strukturbrott | säker | se regeltabell nedan | se nedan |
| Sväljt fel | trolig | `catch` som är tomt eller bara loggar och returnerar `null`/`undefined` | "Fel tystas här. Användaren märker inget om något går sönder." |

Strukturregler i MVP:

| Regel | Säkerhet | Fråga |
|---|---|---|
| Fil med `"use client"` läser hemlig miljövariabel (utan `NEXT_PUBLIC_`) eller importerar serverpaket (`@prisma/client`, `pg`, `mysql2`, `server-only`, `fs`, `firebase-admin`, `stripe`) | säker | "Den här komponenten körs i webbläsaren men rör databasen eller en hemlig nyckel." |
| Fil med `"use client"` läser eller skriver en tabell direkt | trolig (Supabase med radsäkerhet är legitimt) | "Sidan pratar direkt med databasen. Vanligtvis går det via en serverfunktion." |
| Cirkulärt beroende mellan filer (typ-importer räknas inte) | säker | "Dessa filer använder varandra i en cirkel." |
| Hemlig nyckel hårdkodad (sträng som matchar kända nyckelmönster, t.ex. `sk_live_`, `sk-`) | säker | "Det här ser ut som en hemlig nyckel direkt i koden." |

Verktygskonfiguration i projektroten (`next.config.*`, `tailwind.config.*` och andra `*.config.*`) blir inte noder på kartan men räknas som ingångspunkter.

Varje nod får en **hälsopoäng 1 till 10**. Start 10. Avdrag: säkert fynd -2, troligt fynd -1, golv 1. Zonens poäng är snittet viktat med antal rader. Poängen förklaras alltid med en mening ("4/10: tre nästan identiska funktioner").

Fynd som användaren avfärdar ("Det här är okej") sparas i `.mapskill/dismissed.json` med en hash av den berörda koden och visas inte igen förrän koden ändras.

---

## 4. Arkitektur

### 4.1 Översikt

```
┌──────────────────────── Claude Code ─────────────────────────┐
│  plugin: mapskill                                             │
│   hooks ── SessionStart / PreToolUse / PostToolUse /          │
│            Stop / UserPromptSubmit  ──┐                       │
│   .mcp.json ── mapskill mcp (stdio) ──┤                       │
│   skills/mapskill/SKILL.md            │                       │
└───────────────────────────────────────┼───────────────────────┘
                                        │ HTTP 127.0.0.1
                              ┌─────────▼──────────┐
                              │  mapskill daemon   │  en per projekt
                              │  watcher           │
                              │  indexer + adapter │
                              │  analyzers         │
                              │  goals             │
                              │  requests (kö)     │
                              │  HTTP + WebSocket  │
                              └─────────┬──────────┘
                                        │ WebSocket
                              ┌─────────▼──────────┐
                              │  Kartvy (React)    │  http://127.0.0.1:<port>
                              └────────────────────┘
```

Ett npm-paket, `mapskill`, med ett CLI som har underkommandon: `daemon`, `mcp`, `hook <event>`, `scan`, `open`. Pluginet anropar CLI:t. Samma kod används överallt.

### 4.2 Paketstruktur

```
mapskill/
  packages/
    core/              ren logik, inga sidoeffekter utöver filläsning
      src/
        model/         typer: Node, Edge, Finding, Graph, Goal
        parse/         TypeScript-extraktor (filer -> symboler, importer, anrop)
        resolve/       modulupplösning med tsconfig-alias
        adapters/
          nextjs/      filer + symboler -> noder, zoner, kanter
        analyze/
          duplicates.ts
          unused.ts
          complexity.ts
          rules.ts
          errors.ts
          health.ts
        goals/         mall-laddning och utvärdering
        graph/         grafbygge, inkrementell uppdatering, diff
        text/          klarspråk, en/sv
    cli/               daemon, mcp, hooks, scan, open
      src/
        daemon/        watcher, state, HTTP, WebSocket
        mcp/           MCP-server (stdio) som pratar med daemon
        hooks/         ett kommando per hook-händelse
        locks.ts       läser låsfilen direkt från disk
    ui/                Vite + React + React Flow + elkjs
  plugin/
    .claude-plugin/plugin.json
    .mcp.json
    hooks/hooks.json
    skills/mapskill/SKILL.md
  goals/               inbyggda mallar (YAML)
  fixtures/            testrepon
```

Varje modul i `core/analyze` tar en `Graph` och returnerar `Finding[]`. De känner inte till varandra, daemonen eller UI:t.

### 4.3 Komponenter

#### Parser och extraktor (`core/parse`)

Indata: filsökväg och innehåll. Utdata per fil:

- importer (specifier, importerade namn, typ-import eller inte)
- exporter (namn, typ: funktion/klass/variabel, default eller inte)
- funktioner (namn, radintervall, returnerar JSX ja/nej, antal satser, normaliserade token-sekvenser för dubblettdetektion, kognitiv komplexitet, max nästling)
- direktiv (`"use client"`, `"use server"`)
- anrop av intresse: `fetch`-strängar, `supabase.from(...)` med metodkedja, `prisma.<modell>.<metod>`, `process.env.X`
- tomma eller tystande `catch`-block
- strängar som matchar hemliga nyckelmönster

Parsning med `ts.createSourceFile` (ingen typkontroll). En fil som inte går att parsa ger en `ParseError`, och föregående lyckade resultat för filen behålls i grafen med markeringen "kunde inte läsas senast".

Extraktorn ligger bakom ett gränssnitt `Extractor { languages: string[]; extract(path, text): FileFacts }` så tree-sitter-baserade extraktorer för andra språk kan läggas till senare.

#### Modulupplösning (`core/resolve`)

Läser `tsconfig.json`/`jsconfig.json` (inklusive `extends` och `paths`), använder `ts.resolveModuleName` med ett cachat `ModuleResolutionHost`. Importer som pekar utanför projektet (node_modules) blir antingen en extern tjänst (om paketet finns i listan över kända SDK:er) eller ignoreras.

#### Next.js-adapter (`core/adapters/nextjs`)

Upptäcker att projektet är Next.js (beroende `next` i `package.json` och `app/` eller `pages/`). Om inte: Mapskill visar ett vänligt meddelande "Det här projektet stöds inte än" och kör bara de generiska analyserna (dubbletter, oanvänt, komplexitet) med filer som noder.

Gör om filfakta till noder enligt tabell 3.1, beräknar rutter från mappstrukturen (inklusive `(grupper)`, `[param]`, `[...rest]`, `@slots` ignoreras i namnet), och bygger kanter enligt tabell 3.3. Listan över kända SDK:er ligger i `adapters/nextjs/services.ts` (Stripe, OpenAI, Anthropic, Resend, Clerk, NextAuth/Auth.js, Supabase, Firebase, Prisma, Vercel AI SDK, Uploadthing, Sentry, PostHog). Prisma-modeller läses från `prisma/schema.prisma` med en enkel radbaserad läsare för `model X {`.

#### Graf (`core/graph`)

`Graph` innehåller `files`, `nodes`, `edges`, `findings`. Inkrementell uppdatering: `applyFileChanges(graph, changed[], removed[]) -> GraphDelta`. Stegen:

1. Parsa om ändrade filer (endast om innehållshash ändrats).
2. Ta bort alla noder och kanter som kommer från ändrade eller borttagna filer.
3. Bygg om dem från nya filfakta.
4. Bygg om kanter **in till** ändrade filer från filer som importerar dem (importer kan nu peka på nya eller försvunna exporter).
5. Kör analyser. Dubblettanalysen jämför ändrade funktioner mot ett index över alla funktioners fingeravtryck. Oanvänt och föräldralösa filer räknas om globalt (billigt i små repon).
6. Returnera `GraphDelta { addedNodes, removedNodeIds, changedNodes, addedEdges, removedEdgeIds, addedFindings, resolvedFindingIds }`.

Cache: `.mapskill/cache.json` sparar filfakta per filhash så omstart blir snabb.

#### Analyser (`core/analyze`)

Se tabell 3.4. Dubbletter:

- Normalisering: tokens från TypeScripts scanner, utan kommentarer och blanksteg. "Omdöpt" byter alla identifierare mot `ID` och alla litteraler mot `LIT`.
- Exakt och omdöpt: hash av normaliserad token-sekvens per funktion, grupperas på hash.
- Nästan: 5-tokens-shingles (omdöpt variant), parvis exakt Jaccard med ett storleksfilter (mängderna måste vara minst 80 % lika stora). MinHash införs först om mätningar visar att det behövs.
- Varje dubblettgrupp blir ett fynd. Den **äldsta** funktionen (efter först sedd i sessionen, annars filens mtime) föreslås som den som ska behållas.

#### Mål och mallar (`core/goals`, `goals/*.yaml`)

Användaren väljer ett mål i kartan. Valet sparas i `.mapskill/goal.yaml` (kan checkas in). Inbyggda mål i MVP:

1. Landningssida
2. Webbapp med inloggning
3. SaaS med inloggning och betalning
4. Intern CRUD-app (lista, skapa, redigera, ta bort)

Mallformat:

```yaml
id: saas-auth-payments
title: { en: "SaaS with login and payments", sv: "SaaS med inloggning och betalning" }
extends: webapp-auth
items:
  - id: checkout-route
    title: { en: "Checkout endpoint", sv: "API för betalning" }
    why: { en: "Customers need a way to start a payment.", sv: "Kunden behöver ett sätt att starta en betalning." }
    zone: server
    nodeType: api-route
    check:
      anyNode: { type: api-route, talksTo: stripe }
    suggest: { path: "app/api/checkout/route.ts" }
  - id: webhook
    title: { sv: "Webhook från betalleverantören" }
    check:
      anyNode: { type: api-route, routeMatches: "webhook" }
  - id: env-example
    title: { sv: "Exempel på miljövariabler (.env.example)" }
    check: { fileExists: ".env.example" }
```

Kontrolltyper i MVP (inga fler): `fileExists`, `anyNode` med filter (`type`, `routeMatches`, `talksTo`, `touchesTable`, `nameMatches`), `noFindings` av viss typ, `all`/`any` för att kombinera. Utvärderingen är helt deterministisk.

Uppfyllda punkter visas som en bock i målpanelen. Ej uppfyllda blir **spöknoder** i rätt zon.

#### Förfrågningar och lås (`cli/daemon`, `cli/locks.ts`)

Tre knappar per nod:

| Knapp | Vad som händer |
|---|---|
| **Lås** | Nodens filer läggs till i `.mapskill/locks.json`. PreToolUse-hooken blockerar Edit/Write/MultiEdit på dessa filer med förklaringen "Användaren har låst <nod> i Mapskill. Fråga användaren innan du ändrar den." Lås kan hävas med samma knapp. |
| **Fråga** | En förfrågan "Förklara <nod> för mig på enkel svenska: vad den gör, vem som använder den, och om något verkar fel." läggs i kön. |
| **Bygg** (spöknoder och fynd) | För spöknod: "Lägg till <titel> (<varför>). Föreslagen plats: <path>. Återanvänd befintliga <relevanta noder>." För fynd: fyndets färdiga instruktion till Claude. |

Kön ligger i `.mapskill/requests.json`. Användaren går till Claude och skriver vad som helst (t.ex. "kör"). UserPromptSubmit-hooken lägger väntande förfrågningar som extra kontext och markerar dem som skickade. Knappen "Kopiera till Claude" finns alltid som reserv och lägger texten i urklipp.

Lås läses direkt från disk av hooken, så de gäller även om daemonen inte körs.

#### Daemon (`cli/daemon`)

- En daemon per projektrot. Startar via SessionStart-hooken eller `mapskill open`.
- Skriver `.mapskill/daemon.json` med `{ pid, port, token, version }`. Andra processer hittar den där. Om pid inte lever startas en ny.
- Lyssnar endast på `127.0.0.1`, slumpmässig ledig port. Alla anrop kräver `token` (i header för HTTP, i första meddelandet för WebSocket) så andra webbsidor i webbläsaren inte kan läsa grafen.
- Watcher: `@parcel/watcher`, ignorerar `node_modules`, `.next`, `.git`, `.mapskill`, `dist`, `build`, och allt i `.gitignore`. Händelser debouncas 200 ms.
- Stänger sig själv efter 30 minuter utan ansluten klient och utan hook-anrop.

HTTP-API (internt, används av hooks, MCP och UI):

| Metod och väg | Syfte |
|---|---|
| `GET /api/graph` | hela grafen |
| `POST /api/touched` | `{ files, toolUseId, sessionId }` från PostToolUse |
| `GET /api/findings?since=<turnId>` | nya fynd sedan ett varv |
| `POST /api/turn` | markera början på nytt varv (från UserPromptSubmit) |
| `GET /api/requests/pending`, `POST /api/requests/:id/sent` | förfrågningskön |
| `POST /api/requests`, `POST /api/locks`, `POST /api/dismiss`, `PUT /api/goal` | från UI |
| `GET /api/similar?name=&code=` | för MCP `find_similar` |
| `WS /ws` | push av `GraphDelta` och aktivitetshändelser |

#### Hooks (`plugin/hooks/hooks.json` -> `mapskill hook <event>`)

| Händelse | Matcher | Beteende | Om daemonen saknas |
|---|---|---|---|
| SessionStart | alla | startar daemonen om den inte körs, returnerar `additionalContext`: "Mapskill-kartan: http://127.0.0.1:<port>/?t=<token>" | försöker starta, tyst vid fel |
| UserPromptSubmit | alla | `POST /api/turn`, hämtar väntande förfrågningar och returnerar dem som `additionalContext` | inget |
| PreToolUse | `Edit\|Write\|MultiEdit\|NotebookEdit` | om målfilen är låst: blockera (exit 2) med förklaring | läser `locks.json` från disk, fungerar ändå |
| PostToolUse | `Edit\|Write\|MultiEdit\|Bash` | asynkron: skickar ändrade filer (`tool_input.file_path`, eller `bashEditDiff` för Bash) till daemonen | inget |
| Stop | alla | hämtar **säkra** fynd som uppstått detta varv i filer Claude rört. Om några finns och `stop_hook_active` är falskt: `decision: block` med en kort lista och instruktion att åtgärda eller förklara varför inte. Högst 5 fynd, högst en blockering per varv. | inget |

Alla hooks utom låskontrollen är **fail-open**: om något går fel släpps Claude igenom och felet loggas i `.mapskill/log.txt`. Varje hook har en tidsgräns på 5 sekunder (Stop: 10 sekunder).

#### MCP-server (`mapskill mcp`)

Startas av Claude Code via `.mcp.json`. Pratar med daemonen över HTTP; startar den om den saknas. Verktyg:

| Verktyg | Indata | Utdata |
|---|---|---|
| `map_overview` | `maxNodes?` | zoner, noder per zon med en rad var, hälsopoäng, aktivt mål. Begränsad till ca 2 000 tokens |
| `find_similar` | `name?`, `code?` | upp till 5 befintliga funktioner som liknar, med fil, rader och likhet |
| `node_details` | `nodeId` eller `path` | nodens typ, vilka som använder den, vad den använder, fynd |
| `turn_findings` | inga | fynd som uppstått detta varv |
| `goal_gaps` | inga | ej uppfyllda punkter i valt mål med förslag på plats |

#### Skill (`plugin/skills/mapskill/SKILL.md`)

Kort instruktion som Claude får när pluginet är aktivt:

- Innan du skapar en ny funktion, komponent eller fil: anropa `find_similar` och återanvänd om något passar.
- Låsta filer får inte ändras utan att användaren uttryckligen ber om det.
- Lägg ny kod där projektets struktur säger (se `map_overview`), inte i samma fil som anropar den.
- När användaren ber om förklaring av något i kartan: svara på enkel svenska om användaren skriver svenska, och undvik jargong eller förklara den.
- Om Stop-hooken rapporterar fynd: åtgärda de du håller med om och förklara kort de du inte håller med om.

#### Kartvy (`packages/ui`)

Byggd med Vite, React, React Flow (`@xyflow/react`) och `elkjs`. Levereras som statiska filer av daemonen.

Layout:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Mapskill · min-app        Mål: SaaS med betalning (5/8)   Hälsa: 7/10  │
├──────────────────────────────────────────────────┬─────────────────────┤
│  ┌ Sidor ─────────┐  ┌ Server ─────────┐          │ Profil (sida)       │
│  │ /  /profile ●  │  │ POST /api/...   │          │ /profile            │
│  │ /login  ┄┄┄┄┄  │  │ ┄ webhook ┄┄    │          │                     │
│  └────────────────┘  └─────────────────┘          │ Vad det är:         │
│  ┌ Byggstenar ────┐  ┌ Data ──┐ ┌ Utanför ┐       │ En sida som visar…  │
│  │ ProfileCard  ● │  │profiles│ │ Stripe  │       │                     │
│  └────────────────┘  └────────┘ └─────────┘       │ ⚠ Liknar formatDate │
│  ┌ Delat ─────────┐                               │   Behövs båda?      │
│  │ formatDate     │                               │   [Bygg] [Okej]     │
│  │ formatDate2 ⚠  │                               │                     │
│  └────────────────┘                               │ [Lås] [Fråga]       │
│                                                   │ app/profile/page.tsx│
├──────────────────────────────────────────────────┴─────────────────────┤
│ Aktivitet: Claude ändrade 3 filer i Sidor och Delat · 14:02            │
└────────────────────────────────────────────────────────────────────────┘
```

- Zoner är grupper (compound nodes) i ELK. Positioner sparas i `.mapskill/layout.json` och skickas som utgångsläge till ELK vid varje omlayout, så kartan inte hoppar.
- Noder rörda under senaste varvet pulserar i 10 sekunder och har en tunn ram tills nästa varv.
- Kanter visas bara för vald nod som standard (resten blir för rörigt), med ett reglage "visa alla kopplingar".
- Spöknoder är streckade med en `+`.
- Sidopanelen visar: klarspråksbeskrivning av nodtypen, vem som använder noden, vad den använder, fynd som frågor med knappar, filväg och de första 40 raderna kod (skrivskyddat, med syntaxfärg via Shiki).
- Målpanel (fällbar): lista med bockar och spöknodernas titlar.
- Tillgänglighet: hela kartan går att använda med tangentbord (tab mellan noder, enter öppnar panel). Färg är aldrig enda signalen: fynd har ikon och text.
- Ljust och mörkt tema efter systemet.

---

## 5. Dataflöden

### 5.1 Uppstart

1. Claude Code startar en session. SessionStart-hooken kör `mapskill hook session-start`.
2. Hooken läser `.mapskill/daemon.json`. Saknas eller död: startar `mapskill daemon` frikopplat och väntar högst 3 sekunder på att `daemon.json` dyker upp.
3. Daemonen skannar projektet, läser cachen, parsar ändrade filer, bygger grafen, kör analyser, startar watcher och HTTP.
4. Hooken returnerar kartans adress som extra kontext. Claude kan nämna den för användaren. `mapskill open` öppnar den i webbläsaren.

### 5.2 En redigering

1. Claude kör Edit på `app/profile/utils.ts`.
2. PostToolUse-hooken (asynkron) skickar `{ files: [...], toolUseId }`. Samtidigt ser watchern ändringen. Daemonen slår ihop dem inom debounce-fönstret och markerar ändringen som "gjord av Claude".
3. `applyFileChanges` ger en `GraphDelta`.
4. Daemonen pushar delta och en aktivitetshändelse över WebSocket.
5. UI:t patchar sin graf, kör ELK med sparade positioner, animerar nya noder.

Mål: punkt 2 till 5 på under 2 sekunder för ett projekt med 500 filer.

### 5.3 Slutet av ett varv

1. Claude försöker avsluta. Stop-hooken anropar `GET /api/findings?since=<turnId>&touchedOnly=true&certainty=certain`.
2. Inga fynd: hooken avslutar tyst.
3. Fynd och `stop_hook_active` falskt: hooken returnerar `{ "decision": "block", "reason": "<lista>" }`. Claude fortsätter, åtgärdar eller förklarar.
4. När Claude försöker avsluta igen är `stop_hook_active` sant och hooken släpper igenom oavsett.

### 5.4 Från karta till Claude

1. Användaren klickar Bygg på spöknoden "Inloggningssida".
2. UI:t skickar `POST /api/requests`. Kön sparas på disk. UI:t visar "Väntar: skriv något till Claude för att skicka" och en kopieringsknapp.
3. Användaren skriver "kör" i Claude. UserPromptSubmit-hooken hämtar förfrågan och lägger den som extra kontext.
4. Claude bygger. Spöknoden blir en riktig nod när filen dyker upp och mallkontrollen går igenom.

---

## 6. Felhantering

| Situation | Beteende |
|---|---|
| Fil går inte att parsa (halvskriven) | Behåll senaste lyckade version, gul markering "kunde inte läsas", inga nya fynd för filen |
| `tsconfig` saknas eller är trasig | Använd standardinställningar plus `@/* -> ./*` och `@/* -> ./src/*` om `src/` finns |
| Inte ett Next.js-projekt | Generiskt läge: filer som noder, bara dubbletter, oanvänt och komplexitet; tydligt meddelande |
| Projektet är stort (över 3 000 källfiler) | Varning i UI; kanter visas bara för vald nod; analyser körs ändå |
| Daemonen kraschar | Hooks fail-open; nästa hook eller `mapskill open` startar en ny; UI:t visar "Återansluter…" och försöker igen med backoff |
| Två Claude-sessioner i samma projekt | Delar samma daemon; fynd per varv hålls isär med `sessionId` |
| Port upptagen | Välj annan ledig port, skriv om `daemon.json` |
| `.mapskill/` saknas i `.gitignore` | Vid första start: lägg till `.mapskill/*` och `!.mapskill/goal.yaml` i `.gitignore` om filen finns, och skriv en rad i loggen. `goal.yaml` och `locks.json` kan användaren välja att checka in senare |
| Watcher missar händelser (Windows, nätverksenheter) | PostToolUse-hooken är en andra källa; dessutom full omskanning med hash-jämförelse var 60:e sekund när ändringar skett |

---

## 7. Integritet och säkerhet

- Ingen nätverkstrafik utöver `127.0.0.1`. Ingen telemetri i MVP.
- Token krävs för all åtkomst till daemonen.
- Mapskill läser aldrig innehållet i `.env*`-filer, bara variabelnamn som används i koden.
- Mapskill skriver bara i `.mapskill/` och, en gång, i `.gitignore`.
- Kodutdrag i UI:t visas endast lokalt.

---

## 8. Testning

| Nivå | Vad | Hur |
|---|---|---|
| Enhet | parser, resolver, varje analys, mallutvärdering, Next.js-rutter | Vitest, små kodsträngar in, förväntade fakta ut |
| Fixture-repon | hela kedjan från filer till graf och fynd | `fixtures/` med 4 små Next.js-appar (se nedan); snapshot-test av `mapskill scan --json` |
| Inkrementellt | att `applyFileChanges` ger samma graf som full skanning | egenskapsbaserat test: slumpa ändringar i en fixture, jämför inkrementell graf med fullskanning |
| Hooks | varje hook med exempel-JSON in, förväntad stdout/exitkod ut, med och utan daemon | Vitest som kör CLI:t som underprocess |
| MCP | verktygen svarar enligt schema | MCP SDK:s testklient |
| UI | kartan renderar fixture-graf, klick ger panel, delta animeras | Playwright röktest mot daemon med fixture |
| Prestanda | uppdatering under 2 s på 500 filer | genererad fixture med 500 filer, mätt i CI |
| Verklig användning | Claude Code med pluginet på en riktig vibekodad app | manuell testsession per milstolpe, skriftliga anteckningar |

Fixtures:

1. `clean-app`: liten korrekt Next.js + Supabase-app. Förväntat: inga säkra fynd.
2. `messy-app`: planterade exakta, omdöpta och nästan-dubbletter, oanvända exporter, en föräldralös fil, en klientkomponent som rör databasen, ett tomt catch, en hårdkodad nyckel.
3. `conventions-app`: alla Next.js-filkonventioner (grupper, dynamiska rutter, `metadata`, `generateStaticParams`, `route.ts` med flera metoder). Förväntat: **noll** felaktiga "oanvänd"-fynd.
4. `half-saas`: inloggning men ingen betalning. Förväntat: rätt spöknoder för målet "SaaS".

---

## 9. Framgångskriterier för MVP

| Kriterium | Mål |
|---|---|
| Planterade säkra fynd i `messy-app` som hittas | 100 % |
| Felaktiga säkra fynd i `clean-app` och `conventions-app` | 0 |
| Tid från sparad fil till uppdaterad karta, 500 filer | under 2 s |
| Kallstart till färdig karta, 500 filer | under 10 s |
| I 10 testvarv där Claude ombeds lägga till funktionalitet som redan finns, andel där Claude återanvänder i stället för att duplicera, med pluginet jämfört med utan | tydlig förbättring, mäts och rapporteras |
| Testanvändare (3 till 5 vibekodare) som öppnar kartan igen under vecka två utan påminnelse | minst hälften; annars stoppas arbetet med dra-och-bygg |

---

## 10. Riskerna från researchen och hur designen möter dem

| Risk i rapporten | Motåtgärd i designen | Var |
|---|---|---|
| Kartor man bara tittar på överges | Varje nod har Lås, Fråga och Bygg; skyddsräcket verkar via hooks även när kartan är stängd | 4.3 Förfrågningar och lås, Hooks |
| LLM-ritade kartor är fel | Ingen LLM i Mapskill; all struktur från TypeScripts parser | B3, B5 |
| Diagram ruttnar | Uppdatering vid varje sparning och agentvarv | 5.2 |
| Visuell programmering misslyckas | Ingen fri ritning i MVP; bara spöknoder från mallar | B8, 10 Utanför MVP |
| Nybörjare blir beroende av bilden | Sidopanelen visar riktig kod och filväg; noder förklarar vokabulär | 4.3 Kartvy |
| Nybörjare kan inte bedöma förslag | Bara säkra fynd når Claude via Stop-hooken; alla fynd är frågor; Mapskill ändrar aldrig kod själv | 3.4, 5.3, Icke-mål |
| "Vad saknas" hallucinerar | Användaren väljer målet; kontrollerna är deterministiska | 4.3 Mål och mallar |
| Agenterna gör kartan onödig | Kartan är styrning, inte index; MCP ger agenten samma modell | 4.3 MCP-server, Skill |
| Incumbents kan bygga det | Kilen är nybörjare som styr agenten, med ramverksmedvetna begrepp | 3.1 |
| Låg betalningsvilja, LLM-kostnad | Gratis, MIT, ingen LLM-kostnad | B5, B7 |
| Kodsekretess | Allt lokalt, endast `127.0.0.1` med token, läser aldrig `.env`-innehåll | 7 |
| Flerspråksbördan | En stack; `Extractor`- och `Adapter`-gränssnitt för senare | B2, 4.3 Parser |
| Inlåsning | Koden är enda källan till sanning; allt Mapskill sparar ligger i `.mapskill/` och kan raderas | 7 |

Kvarstående risk som designen inte löser: om testanvändarna inte återvänder till kartan. Den mäts i M6 och avgör om arbetet med dra-och-bygg fortsätter.

---

## 11. Utanför MVP men förberett

- **Vite + React Router-adapter** (Lovable): samma `Adapter`-gränssnitt.
- **Python/FastAPI** via tree-sitter-extraktor bakom `Extractor`-gränssnittet.
- **Kanvas till spec**: användaren lägger till och kopplar planerade noder fritt; exporteras till `docs/mapskill-plan.md` och regler i `CLAUDE.md`. Grafmodellen har redan fältet `planned: boolean`.
- **Semantiska dubbletter** med lokal embedding-modell.
- **Export av strukturregler** till dependency-cruiser för CI.
- **VS Code-webview** som visar samma UI.
