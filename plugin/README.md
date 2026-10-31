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

## Låsa filer

Kommandot `mapskill` finns inte på din PATH när bara pluginet är installerat. Kör det från Mapskill-repot med en absolut sökväg, så fungerar det var som helst:

    pnpm mapskill lock <absolut sökväg>

Eller kör den paketerade filen inifrån projektmappen, då går en relativ sökväg bra:

    node <sökväg till repot>/plugin/dist/mapskill.mjs lock <sökväg>

Lås tas bort med `unlock` i stället för `lock`, eller genom att du tar bort raden i `.mapskill/locks.json`.

## Kartan

Öppna kartan i webbläsaren från ditt projekt:

    node <sökväg till repot>/plugin/dist/mapskill.mjs open

Claude får också kartans adress när sessionen startar och kan ge dig den.
