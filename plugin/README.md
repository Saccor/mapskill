# Mapskill-pluginet för Claude Code

Bygg först den paketerade filen från repots rot:

    pnpm install
    pnpm build:plugin

Starta sedan Claude Code med pluginet i ett Next.js-projekt:

    claude --plugin-dir <sökväg till repot>/plugin

Pluginet gör fyra saker:

- startar Mapskills bakgrundsprocess när sessionen börjar
- stoppar ändringar i filer du låst med `mapskill lock <fil eller mapp>`
- påminner Claude om nya dubbletter och andra säkra fynd innan Claude avslutar sitt svar
- ger Claude verktygen `map_overview`, `find_similar`, `node_details` och `turn_findings`
