# Mapskill MVP: färdplan

Spec: [2026-10-30-mapskill-mvp-design.md](../specs/2026-10-30-mapskill-mvp-design.md)

Specen täcker flera delsystem. Varje milstolpe nedan ger fungerande, testbar mjukvara på egen hand och får en egen detaljerad plan när föregående milstolpe är klar. Milstolpe 1 är redan detaljplanerad.

Tidsuppskattning: en erfaren fullstack-utvecklare, ±50 %.

| # | Milstolpe | Veckor | Detaljplan | Levererar |
|---|---|---|---|---|
| M1 | Analysmotor och `mapskill scan` | 2 | [2026-10-30-m1-analysis-engine.md](2026-10-30-m1-analysis-engine.md) | Parser, modulupplösning, Next.js-adapter, graf, alla analyser, CLI som skriver ut karta och fynd |
| M2 | Inkrementell graf och daemon (klar) | 1,5 | [2026-10-30-m2-daemon.md](2026-10-30-m2-daemon.md) | `applyFileChanges`, filvakt, cache, HTTP + WebSocket med token, `daemon.json`, självavstängning |
| M3 | Claude Code-plugin (klar) | 1,5 | [2026-10-31-m3-plugin.md](2026-10-31-m3-plugin.md) | Hooks (SessionStart, UserPromptSubmit, PreToolUse-lås, PostToolUse, Stop), MCP-server med fem verktyg, skill |
| M4 | Kartvy (klar) | 3 | [2026-10-31-m4-map-view.md](2026-10-31-m4-map-view.md) | React Flow + ELK med stabil layout, sidopanel, aktivitetsrad, pulserande noder, knapparna Lås och Fråga, förfrågningskö |
| M5 | Mål och spöknoder (klar) | 1,5 | [2026-10-31-m5-goals.md](2026-10-31-m5-goals.md) | YAML-mallar, fyra inbyggda mål, utvärdering, spöknoder, Bygg-knappen |
| M6 | Härdning och testanvändare | 1,5 | skrivs nu | npm-paketering, plugin-marknadsplatsfil, prestandatest med 500 filer, 3 till 5 testanvändare, mätning av återkomst vecka två |

**Tunn demo efter M3** (cirka 5 veckor): skyddsräcket fungerar i Claude Code utan kartvy. Claude stoppas från att ändra låsta filer och påminns om dubbletter innan den avslutar ett varv. Det räcker för att testa kärnhypotesen att återanvändning ökar.

## Acceptanskriterier per milstolpe

**M1**
- `mapskill scan fixtures/messy-app` hittar varje planterat säkert fynd.
- `clean-app` och `conventions-app` ger noll säkra fynd.
- Alla tester gröna på Windows och Linux.

**M2**
- Egenskapstest: slumpade ändringar i en fixture ger samma graf inkrementellt som vid full skanning.
- Ändring till pushad delta under 2 sekunder på en genererad fixture med 500 filer.
- Daemon som kraschat startas om av nästa anrop; `daemon.json` med död pid ersätts.

**M3**
- Varje hook testad med exempel-JSON, med och utan daemon. Låskontrollen fungerar utan daemon.
- Stop-hooken blockerar högst en gång per varv (`stop_hook_active`).
- Manuell testsession: be Claude lägga till en datumformaterare i `messy-app`. Med pluginet ska Claude återanvända `formatDate`.

**M4**
- Playwright-röktest: karta renderar `clean-app`, klick öppnar panel, en filändring syns som pulserande nod.
- Noder byter inte plats vid omlayout när bara en fil ändrats.
- Kartan går att använda med tangentbord.

**M5**
- `half-saas`-fixturen ger rätt spöknoder för målet "SaaS med inloggning och betalning".
- Bygg på en spöknod hamnar i Claude via UserPromptSubmit-hooken.

**M6**
- `npx mapskill` fungerar på en ren Windows- och macOS-maskin.
- Minst hälften av testanvändarna öppnar kartan under vecka två utan påminnelse. Annars stoppas arbetet med dra-och-bygg.
