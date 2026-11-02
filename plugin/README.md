# Mapskill-pluginet för Claude Code

Bygg först den paketerade filen från repots rot:

    pnpm install
    pnpm build:plugin

Starta sedan Claude Code med pluginet i ett Next.js-projekt:

    claude --plugin-dir <sökväg till repot>/plugin

Pluginet gör fyra saker:

- startar Mapskills bakgrundsprocess när sessionen börjar
- stoppar ändringar i filer du låst (se nedan)
- påminner Claude om nya dubbletter och andra säkra fynd innan Claude avslutar sitt svar
- ger Claude verktygen `map_overview`, `find_similar`, `node_details` och `turn_findings`

## Kommandon

Skriv dem i Claude Code:

- `/mapskill:map` öppnar kartan över projektet i webbläsaren. Claude ger dig också adressen.
- `/mapskill:lock <fil eller mapp>` låser filen eller mappen, så att Claude måste fråga innan något ändras.
- `/mapskill:unlock <fil eller mapp>` tar bort låset.
- `/mapskill:stats` visar hur Mapskill har använts, som en text du kan kopiera till den som bad dig testa. Inget skickas.

Du kan också ta bort ett lås genom att ta bort raden i `.mapskill/locks.json`.
