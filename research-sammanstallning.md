# Deep Research: Visuell kodkarta och skyddsräcken för vibekodare

Datum: 2026-10-30
Metod: fyra parallella researchspår (marknad, teknik, problem/evidens, kritik/risker), ca 45 sökningar och ca 80 lästa källor via Firecrawl. Alla siffror är hämtade från källorna i slutet av dokumentet. Osäkerhet markeras i texten.

---

## 1. Sammanfattning (läs bara detta om du har bråttom)

**Problemet är verkligt och mätbart.** AI-genererad kod dubblerar sig själv (+81 % dubblerade kodblock sedan 2023), återanvänder mindre (-35 % anrop mellan filer), sväljer fel oftare (+47 %) och innehåller säkerhetshål i ca 45 % av fallen. Skulden hamnar enligt GitClear "hos utvecklare som inte känner igen felmönstren", alltså exakt nybörjare. Utvecklare känner sig dessutom snabbare med AI fast de ofta är långsammare, så folk ser inte kostnaden de drar på sig. Det talar starkt för en alltid-synlig visuell yta i stället för en rapport man måste leta upp.

**Delarna finns redan, men inte helheten.** Automatiska kodkartor för Claude Code och Cursor finns i mängd (graphify 139k stjärnor, Understand-Anything 89k, repowise, GitDiagram). Dubblett- och dödkodsdetektorer finns (jscpd, knip, SonarQube). Visuella byggverktyg finns (Figma Make, Onlook, WeWeb). Men **ingen** kombinerar en alltid-färsk karta, en måldriven checklista över vad som saknas, varningar på klarspråk och en kanvas-ändring som blir en exakt spec till agenten, riktat till icke-utvecklare. "Vad saknas för mitt mål"-delen finns inte i någon produkt alls. Att det vuxit fram en konsultkategori som för pengar granskar trasiga Lovable- och Bolt-appar är det tydligaste tecknet på att den automatiska varianten saknas.

**Men kartan i sig har en kyrkogård bakom sig.** CodeSee, den närmaste föregångaren, tog in 10 miljoner dollar, köptes upp 2024 och lades ner. Sourcetrail arkiverades. CodeViz fick på Hacker News svaret "betalar inte 20 dollar i månaden för att titta en nivå djupare". Kartor man bara tittar på överges. **Kartan måste vara något man agerar på, inte ett dokument.** Dessutom har 30 år av visuell programmering (UML, CASE, PowerBuilder) misslyckats för "riktigt" arbete, så "dra boxar och agenten bygger exakt" är den mest riskabla delen av idén.

**Rekommendation.** Bygg det, men i en smalare form: ett lokalt Claude Code-plugin (hooks + MCP + skill) som visar en karta på nybörjarspråk (sidor, API-rutter, tabeller, komponenter, externa tjänster) för **en** stack till att börja med, som uppdateras vid varje agentvarv, och vars huvudjobb är att låta användaren **styra agenten** från kartan: "rör inte detta", "är de här två samma sak?", "jag behöver en sida här". Strukturen beräknas deterministiskt utan LLM. Förslag ska vara få, förhandsvisade som ångringsbara diffar, och formulerade som frågor. Dra-och-bygg-delen sparas till efter att man bevisat att folk öppnar kartan igen efter vecka ett.

Genomförbarhet: hög. Tekniken är mogen och öppen. En erfaren fullstack-utvecklare bygger en MVP på 9 till 12 veckor, en tunn demo på 4 till 5 veckor.

---

## 2. Nyckelfynd

1. **Dubbletter och reuse-kollaps är den dokumenterade skadan.** GitClear (623 miljoner ändrade rader, 2023 till 2026): dubblerade block 40 till 73 per miljon rader, kopierad kod 9,4 % till 15,7 %, flyttad/refaktorerad kod 21 % ner till 3,8 %. Utvecklare är nu fem gånger mer benägna att duplicera än att refaktorera. GitClears egen rekommendation: "snubbeltråd på dubblerade block" och "mät struktur, inte volym". Källa: gitclear.com.
2. **Säkerhet förbättras inte med nyare modeller.** Veracode testade 100+ modeller på 80 uppgifter: 45 % av koden innehåller OWASP Topp 10-sårbarheter, Java ca 70 %. Cloud Security Alliance rekommenderar automatiska grindar vid genereringstillfället, inte efteråt. Källa: veracode.com, labs.cloudsecurityalliance.org.
3. **Upplevelsegapet.** METR:s randomiserade studie: erfarna utvecklare tog 19 % längre tid med AI men trodde att de var 20 % snabbare. Källa: metr.org, arxiv 2507.09089. Liten studie (16 personer), tidiga verktyg, gäller inte nybörjare direkt.
4. **Marknaden för vibekodare är enorm men saknar strukturhjälp.** Lovable ca 400 till 500 miljoner dollar i årsintäkt och ca 8 miljoner användare, Replit ca 525 miljoner, Vercel säger att 30 % av apparna på plattformen är agentgenererade. Ingen av dem visar någon strukturkarta eller hälsovägledning. WeWeb kritiserar öppet Lovable för att samla på sig "buggar och död kod". Siffrorna kommer från sekundära analytikerkällor och varierar.
5. **Kodkartor för agenter är redan en mogen kategori.** graphify (139k stjärnor, filvakt + hooks), Understand-Anything (89k, har ett "junior/PM"-läge), repowise (8k, 27 språk utan LLM, död kod, uppdateras varje push, 12 dollar/mån), Pharaoh (flaggar exakta funktionsdubbletter i PR), GitDiagram (18,6k, enklaste UX men engångs och LLM-gissad).
6. **Dubblett-, dödkods- och komplexitetsverktyg är lösta problem på utvecklarnivå.** jscpd (har nu MCP-server och experimentell semantisk detektion med embeddings), knip (oanvända filer/exports/beroenden, 190+ ramverksplugins), vulture/deptry för Python, dependency-cruiser och eslint-plugin-boundaries för arkitekturregler, SonarSources kognitiva komplexitet, CodeScenes "Code Health". Allt är i utvecklarvokabulär och PR-centrerat, inget är bundet till en karta eller ett mål.
7. **"Vad saknas för mitt mål" finns inte.** Närmaste är handskrivna regler (dependency-cruiser), Structurizr (handritad avsedd arkitektur utan jämförelse mot verklig) och manuella "vibe code audit"-konsulter (NIX United, Beesoul med flera).
8. **Visuella byggverktyg stannar på UI-lagret.** Figma Make, Builder Fusion, Onlook (27k stjärnor), WeWeb, v0 design mode drar komponenter och pixlar, inte arkitektur. Excalidraw + MCP och tldraw låter agenten rita diagram, men diagrammet är ingen validerad spec bunden till repot. tldraw skriver själva att rundresan "visualisera kod, redigera diagram, uppdatera kod" är en riktning de inte levererat.
9. **LLM-ritade kartor är opålitliga.** GitDiagram hittade på beroenden som inte fanns. Ilograph testade ChatGPT och Claude på ett riktigt system: "vagt och felaktigt, hallucinerar DynamoDB". Strukturen måste komma från deterministisk parsning (tree-sitter, importgraf). LLM får bara skriva etiketter och förklaringar.
10. **Nybörjare kan inte bedöma förslag.** 66 % av utvecklare anger "nästan rätt men inte helt" som största frustration med AI. En studie om vibekodning i praktiken beskriver hur assistenter producerade "polerade, attraktiva" förslag som gav sken av produktionsklar app. Statiska analysverktyg överges när de spottar ur sig "skräp att sålla i". Det första felaktiga "ta bort denna dubblett" som kraschar appen dödar förtroendet för gott.
11. **Agenterna indexerar redan, men tappar helheten ändå.** Cursor bygger ett Merkle-träd-synkat index. Claude Code valde medvetet bort index ("glob och grep slog RAG"). Samtidigt visar forskning om "context inflation" att agenter måste läsa om omgivningen varje varv och att kostnaden per commit stiger med repots ålder. Bara 5 % av 10 000 repon har en CLAUDE.md eller AGENTS.md. Nybörjare är minst benägna att skriva en för hand. Det hållbara värdet är en **maskinläsbar, alltid färsk strukturmodell som agenten konsumerar**, där bilden är en biprodukt för människan.
12. **Lokal först är ett krav.** CodeViz-tråden: "vi hade precis en stor incident för att någon laddade upp vår kodbas via ett VS Code-tillägg, jurister inblandade". Repowise valde AGPL-kärna av det skälet. LLM-kostnaden för omanalys är också verklig: GitDiagram vägrar Linux-kärnan (1,3 miljoner tokens, ca 8 dollar per körning).

---

## 3. Detaljerad analys

### 3.1 Vad som finns och vad som saknas (gap-analys)

| Del av din idé | Finns för utvecklare? | Finns för nybörjare? | Kommentar |
|---|---|---|---|
| Automatiskt uppdaterad karta | Ja (graphify, repowise, codegraph, Understand-Anything) | Nej | Alla visar filer, symboler, C4-lager. Understand-Anything har ett "junior"-läge, närmast. |
| Mall över vad som saknas per mål | Nej | Nej | Finns inte i någon produkt. Endast manuella konsulter. |
| Dubblett-/onödig-kod-varningar | Ja (jscpd, knip, Pharaoh, Sonar) | Nej | Aldrig på en karta, aldrig på klarspråk, aldrig med ett klick till agenten. |
| Förenklingsförslag | Ja (CodeScene, CodeRabbit, Qodo) | Nej | PR-centrerat, utvecklarspråk. |
| Dra-och-bygg som ger exakt spec | Nej | Nej | UI-kanvaser finns, arkitekturkanvas bunden till repot finns inte. |

Slutsats: varje primitiv finns, de flesta öppen källkod med MCP- eller plugin-yta. Det sänker byggkostnaden rejält men betyder också att **differentieringen måste vara nybörjar-UX, måldrivna mallar och spec-loopen, inte grafmotorn**.

### 3.2 Hur det kan byggas (teknisk rekommendation)

**Skill, plugin eller app?** Svar: ett **Claude Code-plugin** som paketerar tre saker, plus en webbvy.

- **MCP-server** (en lokal Node-daemon) som äger grafen och erbjuder verktyg som `get_map`, `similar_functions`, `template_gaps`, `rules_check`.
- **Hooks**: en asynkron PostToolUse-hook på Edit/Write/Bash som skickar ändrade filer till daemonen (ger "vad agenten just rörde"), en Stop-hook som returnerar nya varningar som extra kontext till Claude innan den avslutar, en SessionStart-hook som startar daemonen.
- **Skill** (`/map`) som lär Claude att alltid anropa `similar_functions` innan den skapar en ny hjälpfunktion. Detta är den direkta lösningen på "AI skapar quickfix-funktioner i stället för att återanvända".
- **Webbvy** på localhost (senare VS Code-webview) med React Flow.

**Parsning**: tree-sitter (MIT, 60+ grammatiker, inkrementell, feltolerant mitt i en redigering). Aiders repo-map-mönster för rankning: filer som noder, kant när A refererar en symbol definierad i B, PageRank för viktighet. Hoppa över SCIP/LSP i MVP, de är för tunga för tangenttryckningsnivå.

**Liveuppdatering**: @parcel/watcher (native, coalescerar händelser så git checkout inte dränker processen, kan hämta ändringar som skedde medan daemonen var av). Hash per fil innan omparsning. Inkrementell omindexering: ta bort filens noder, parsa om, uppdatera grannar. Prior art (Codebase-Memory, arXiv 2603.27277) gör detta på ca 1,2 sekunder.

**Stabil karta när koden ändras** (den svåra biten): ELK-layout med interaktiva lägen och tidigare koordinater sparade i SQLite, så att noder inte hoppar runt. Prototypa detta tidigt, React Flow-teamet varnar för att ELK är komplext.

**Detektion**, i ordning av tillförlitlighet:
1. Exakta och omdöpta dubbletter: token-shingling (jscpd-stil). Deterministiskt, inga falska positiva att tala om.
2. Död kod: symboler utan inkommande kanter i grafen, bekräftat med knip/vulture i batch.
3. Komplexitet: kognitiv komplexitet, nästlingsdjup, "bumpy road", beräknat från egna AST:er. Färga noder 1 till 10 som CodeScene.
4. Arkitekturregler: tillåtna kanter mellan zoner, utvärderade direkt på grafen, exporterbara till dependency-cruiser för CI.
5. Semantiska dubbletter ("formatDate2 är 0,81 lik utils/date.ts:formatDate"): embeddings lokalt via Ollama. Experimentellt, kräver kalibrering per repo. Valfritt tillägg.

**Mallar / "vad saknas"**: upptäck arketyp deterministiskt (next.config + app/ = Next.js, fastapi i pyproject = FastAPI). Mall = deklarativ checklista i YAML per arketyp och mål: krävda sökvägar (`.env.example`, `tests/**`, CI-workflow), grafregler ("ingen fil i app/ importerar db/ direkt"), mjuka förväntningar. LLM används bara för luddiga punkter, aldrig för deterministiska. Rendera saknade delar som **spöknoder** på kartan som användaren kan dra på plats. Det finns ingen offentlig korpus av sådana checklistor, du skriver dem själv per arketyp.

**Kanvas till spec**: lagra den visuella modellen som kanonisk JSON (zoner, noder befintliga/planerade, tillåtna kanter, korta intentioner per nod). Generera deterministiskt: en Markdown-spec i Kiro/Spec Kit-form, ett CLAUDE.md/AGENTS.md-fragment med strukturreglerna, maskinkontrollerbara regler. Stäng loopen med en Stop-hook som mäter drift. Håll intentionerna korta, överspecifikation är den dokumenterade fallgropen i spec-driven utveckling.

**Uppskattad insats** (en erfaren fullstack, ±50 %):

| Del | Veckor |
|---|---|
| Indexer-daemon, TS/JS + Python, SQLite, PageRank | 2 till 3 |
| Metrik, död kod, dubbletter, regelmotor | 1,5 till 2 |
| Kart-UI med stabil layout och live-push | 2 till 3 |
| Claude Code-plugin (MCP, hooks, skill) | 1 |
| Mallar för Next.js och FastAPI, spöknoder | 1 till 1,5 |
| Kanvas till spec-export | 1 till 1,5 |
| **Totalt MVP** | **9 till 12** |
| Tunn demo (bara TS, dagre, inga mallar) | 4 till 5 |

### 3.3 Fungerar det i professionell miljö och för hemmabyggen?

**Hemmabyggare / vibekodare**: ja, det är här behovet är störst och tydligast. Problemen (dubbletter, quickfixar, säkerhet) är kvantifierade, och ingen av plattformarna de använder hjälper dem. Men betalningsviljan är nära noll. CodeViz-tråden: "betalar gärna en engångsavgift och använder min lokala LLM". Prissätt som öppen kärna med egen API-nyckel, eller engångsköp.

**Professionella team**: mer tveksamt som fristående produkt. De har redan repowise, CodeScene, Sonar, CodeRabbit. Deras invändningar: kodsekretess (måste vara lokalt), falska positiva (måste vara deterministiskt), "ännu en dashboard" (måste leva i agentflödet, inte i en separat flik). Där det kan fungera professionellt: som skyddsräcke för agenter, det vill säga strukturmodellen som agenten konsumerar via MCP och hooks. Backthread (25 dollar/plats) säljer just "karta + resonemang bakom agentskrivna PR" till team på 10 till 100 ingenjörer, vilket visar att en nisch finns.

**Ärlig slutsats**: om bara den mänskliga kartan är produkten är det en funktion som Lovable eller Anthropic kan bygga på veckor. Om den agentvända modellen är produkten är det infrastruktur som agentleverantörerna kommer att äga. Det smala utrymmet som ingen täcker är **nybörjaren som styr agenten från kartan** (begränsningar, gränser, "rör inte detta").

---

## 4. Kritik och risker

| # | Risk | Allvar | Åtgärd |
|---|---|---|---|
| 1 | Kartor man tittar på överges (CodeSee, Sourcetrail, CodeViz) | Troligen dödlig om kartan är ett dokument | Kartan är ett inmatningsverktyg: varje nod kan ge agenten en instruktion |
| 2 | LLM-genererad struktur är fel ofta nog att förstöra förtroendet | Dödlig för trust-loopen | Deterministisk parsning, stabil layout, LLM bara för etiketter |
| 3 | Diagram ruttnar eftersom de lever utanför arbetsflödet | Hög | Generera vid varje sparning/agentvarv, visa inne i Claude Code eller editorn |
| 4 | Visuell programmering har misslyckats i 30 år för "riktigt" arbete; även Unreal Blueprints behöver "de-spaghetti"-föreläsningar | Dödlig för "bygger exakt" | Begränsa drag-och-släpp till det genuint strukturella (sidor, entiteter, tjänster, modulgränser). Diagrammet är en begränsning agenten uppfyller, aldrig ett program |
| 5 | Scratch-till-text-gapet: visuella stöd kan göra nybörjare mindre kapabla | Medel | Varje nod länkar till riktig fil och visar riktig kod; förklaringar lär ut vokabulär ("detta är en route handler") |
| 6 | Nybörjare kan inte skilja rätt från fel förslag | Dödlig utan åtgärd | Få förslag, deterministiska där möjligt, alltid förhandsvisad ångringsbar diff med tester körda, formulerade som frågor |
| 7 | "Vad saknas för målet" hallucinerar lättast | Hög | Bara som checklista användaren skrivit eller bekräftat, aldrig autogenererad mållista |
| 8 | Incumbents (Cursor, Claude Code, repowise, Lovable) kan skeppa det nativt | Hög för generell kartprodukt | Välj kilen de är strukturellt dåliga på: nybörjare som styr agent |
| 9 | Hobbyister betalar inte; LLM-omanalys kostar | Medel | Struktur/dubbletter/död kod helt lokalt utan LLM; BYO-nyckel |
| 10 | Kodsekretess | Hög för team | Lokal först, öppen kärna |
| 11 | Flerspråksstöd är en vallgrav du inte har råd med | Medel | En stack på djupet (React/Next + TS + Supabase/Prisma, det Lovable/Bolt/v0 genererar), ramverksmedveten semantik |
| 12 | Om det visuella blir källa till sanning har du återuppfunnit Bubble (inlåsning) | Medel | Koden är enda källan till sanning; diagramändring blir en vanlig commit |

**Motbevis att hålla fast vid**: GitDiagram fick 222 poäng på HN på en vecka, så aptiten på en första-anblick-bild är verklig, särskilt för vilsna personer. Erfarna röster säger att låg-nivå-grafer "nästan alltid är överväldigande" men att filträd-"vibes"-nivån "är exakt vad man vill ha". Nybörjare vill ha C4-toppnivån, inte anropsgrafer. Hadlow, som skrev den mest citerade essän mot visuell programmering, medger att "statiska strukturverktyg (UI-designers, schemadesigners, klassdesigners) kan vara mycket användbara". Blueprints och n8n lyckas för att nodvokabulären är begränsad och domänspecifik.

---

## 5. Förslag på förbättringar av din idé

1. **Vänd på huvudvärdet.** Inte "en karta som visar repot" utan "en fjärrkontroll för agenten som råkar se ut som en karta". Varje nod har tre knappar: Lås (rör inte), Fråga (förklara/är detta dubblett?), Bygg (jag vill ha X här). Det är det ingen gör.
2. **Nybörjarvokabulär i stället för filer.** Noder är Sida, API-rutt, Tabell, Komponent, Extern tjänst, Test. Inte `src/lib/utils.ts`. Kräver ramverksmedvetenhet, därför en stack först.
3. **"Senast rört av agenten"-lager.** Hooks ger `tool_use_id` per ändring, så kartan kan pulsera där agenten just varit. Det är det enklaste sättet för en nybörjare att se "spinna iväg" i realtid.
4. **Snubbeltråd i stället för rapport.** Stop-hooken skickar "du la till `formatDate2`, `utils/date.ts:formatDate` är 0,81 lik, vill du återanvända?" tillbaka till Claude innan varvet avslutas. Agenten rättar sig själv, användaren behöver inte förstå.
5. **Spöknoder för mallen.** Saknade delar ritas som streckade noder man kan dra in. Att dra in en spöknod genererar en spec-uppgift. Det är den lågriskversionen av "dra och bygg".
6. **Hälsopoäng per område, inte per rad.** En siffra 1 till 10 per zon, som CodeScene, men förklarad med en mening. Nybörjare förstår "Betalning: 4/10, tre nästan identiska funktioner".
7. **Exportera reglerna.** Kartans zoner och tillåtna kanter blir ett CLAUDE.md-fragment och en dependency-cruiser-konfig. Då fungerar skyddsräcket även när kartan är stängd, och proffs kan köra det i CI.
8. **Mät retention före dra-och-bygg.** Om folk inte öppnar kartan igen efter vecka ett är det en funktion, inte en produkt. Bygg inte kanvasen förrän det är bevisat.

---

## 6. Öppna frågor

- Förbättrar visualisering i sig förståelsen för nybörjare? Akademisk SoftVis-forskning hann inte granskas. En Monash-studie (2012) fann att "mental map"-bevarande inte ändrade tid/fel men upplevdes lättare.
- Exakt vad CodeSee gjorde fel. Post-mortem-källorna är låg kvalitet ("misaligned value with market demand").
- Hur många vibekodare som skulle betala något alls. Inga data hittades utöver HN-anekdoter.
- Om Claude Code-hook- och plugin-API:erna (FileChanged, mods, monitors är alla nya) är stabila nog att bygga på. Lås en minimiversion.
- Licensen på Codebase-Memory (arXiv 2603.27277) som överlappar indexeringshalvan, kontrollera innan kod lånas.
- Kvalitativa horror stories från r/vibecoding och r/ClaudeAI kunde inte skrapas (Firecrawl stödjer inte Reddit). De kvantitativa GitClear-siffrorna är bästa proxy.

---

## 7. Källor

### Problem och evidens
- https://www.gitclear.com/the_ai_code_quality_maintainability_gap (dubbletter +81 %, reuse -35 %, 2026)
- https://www.gitclear.com/ai_assistant_code_quality_2025_research (2025-rapporten)
- https://www.gitclear.com/developer_ai_productivity_analysis_tools_research_2026 (skuld hos de som inte ser felmönstren)
- https://www.veracode.com/resources/analyst-reports/2025-genai-code-security-report/ (45 % sårbar kod)
- https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-generated-code-vulnerability-surge-2026/ (grindar vid generering)
- https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ och https://arxiv.org/abs/2507.09089 (19 % långsammare, trodde 20 % snabbare)
- https://arxiv.org/html/2512.11922v1 (Vibe Coding in Practice, "fancy features", requirements ambiguity)
- https://dl.acm.org/doi/10.1145/3794786.3830732 (context inflation, agenter läser om varje varv)
- https://packmind.com/context-engineering-ai-coding/context-engineering-large-codebases (5 % har CLAUDE.md)
- https://augmentcode.com/guides/why-ai-agents-repeat-questions (66 % "nästan rätt")
- https://petertsehsun.github.io/soen7481/papers/icse13b.pdf (varför statisk analys överges)

### Marknad
- https://github.com/Graphify-Labs/graphify (139k stjärnor)
- https://github.com/Egonex-AI/Understand-Anything (89k, junior/PM-läge)
- https://repowise.dev och https://repowise.dev/pricing (27 språk, död kod, 12 dollar/mån)
- https://repowise.dev/blog/comparisons/codesee-alternatives-codebase-maps (CodeSee-nedläggning)
- https://pharaoh.so och https://pharaoh.so/blog/codebase-intelligence-tool-comparison-2026/ (PR Guard, jämförelse)
- https://github.com/ahmedkhaleel2004/gitdiagram (18,6k)
- https://www.codeviz.ai och https://news.ycombinator.com/item?id=41393458 (CodeViz HN-tråd)
- https://news.ycombinator.com/item?id=42521769 (GitDiagram HN, hittade på beroenden)
- https://backthread.dev (25 dollar/plats, agentskrivna PR)
- https://gitkraken.com/blog/gitkraken-launches-devex-platform-acquires-codesee
- https://nix-united.com/top-vibe-code-audit-companies/ (konsultkategorin)
- https://www.weweb.io/blog/best-vibe-coding-tools-non-coders (kritik av Lovable)
- https://tech-insider.org/replit-vs-lovable-vs-bolt-new-2026/ och https://www.useluminix.com/reports/industry-analysis/vibe-coding-tool-landscape-replit-v0-base44-bolt-lovable-vercel/source/0 (intäkter, sekundära)
- https://www.nekod.com/blog/lovable-vs-replit-vs-v0-which-one-should-you-choose (Vercel 30 % agentgenererat)
- https://www.builder.io/compare/builder-vs-figma-make, https://github.com/onlook-dev/onlook, https://github.com/tldraw/make-real, https://nimbalyst.com/blog/best-ai-diagram-tools-2026/ (visuella byggverktyg)
- https://www.sonarsource.com/products/sonarqube/, https://www.coderabbit.ai, https://github.com/webpro-nl/knip, https://github.com/kucherenko/jscpd (kodhälsa)
- https://blog.logrocket.com/ai-code-review-tools-2026/

### Teknik
- https://tree-sitter.github.io/tree-sitter/using-parsers/ och .../3-advanced-parsing.html (inkrementell parsning)
- https://aider.chat/docs/repomap.html och https://aider.chat/2023/10/22/repomap.html (PageRank-karta)
- https://arxiv.org/html/2603.27277 (Codebase-Memory, 1,2 s inkrementell omindexering)
- https://cursor.com/blog/secure-codebase-indexing (Merkle-träd)
- https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny (Claude Code utan index)
- https://code.claude.com/docs/en/hooks, /skills, /mcp, /plugins, /plugins/components, /plugins/mods/overview (officiella Claude Code-dokument)
- https://github.com/parcel-bundler/watcher och https://github.com/paulmillr/chokidar (filvakter)
- https://reactflow.dev/learn/layouting/layouting, https://github.com/xyflow/xyflow (kanvas)
- https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html (stabil layout)
- https://www.sonarsource.com/blog/cognitive-complexity-because-testability-understandability/
- https://codescene.io/docs/guides/technical/code-health.html
- https://github.com/sverweij/dependency-cruiser, https://github.com/javierbrea/eslint-plugin-boundaries
- https://github.com/github/spec-kit, https://github.com/github/spec-kit/discussions/3674, https://kiro.dev/docs/specs/, https://agents.md/ (spec-driven)
- https://arxiv.org/html/2602.00180v1 (taxonomi spec-driven utveckling)
- https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- https://tldraw.dev/blog/text-is-not-enough (diagram som gränssnitt)
- https://nextjs.org/docs/app/getting-started/project-structure, https://fastapi.tiangolo.com/tutorial/bigger-applications/ (arketyper)

### Kritik
- https://mikehadlow.blogspot.com/2018/10/visual-programming-why-its-bad-idea.html
- https://news.ycombinator.com/item?id=14482988 (varför visuell programmering suger)
- https://dev.epicgames.com/community/learning/talks-and-demos/z0WW (De-spaghetti your Blueprints)
- https://ilograph.com/blog/posts/diagrams-ai-can-and-cannot-generate
- https://livinginsoftware.substack.com/p/why-are-architecture-diagrams-never
- https://zeroic.in/blog/when-to-rebuild-your-bubble-app, https://kissflow.com/no-code/bubble-alternatives (inlåsning)
- https://ideaproof.io/failure/codesee (låg kvalitet)
- https://vadim.blog/claude-code-no-indexing
- https://bytebell.ai/blog/benchmarking-models (LLM-indexeringskostnad)

Källkvalitet: många jämförelsesidor är skrivna av leverantörer (repowise, Pharaoh, Backthread, WeWeb, Builder, Nimbalyst) och flaggar sin egen produkt. Stjärnor och priser lästes direkt från GitHub och prissidor 2026-10-30. Intäktssiffror för Lovable/Replit är sekundära och varierar. Reddit kunde inte skrapas.

## Rerun Inputs
workflow: firecrawl-deep-research
topic: Visuell kodkarta och skyddsräcken för vibekodare: marknad, teknik, genomförbarhet, risker
depth: thorough
output: markdown
