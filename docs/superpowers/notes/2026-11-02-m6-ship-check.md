# M6: slutprov innan testanvändare (2026-11-02)

Grenen `m6-ship`, version 0.4.0.

## Automatiska prov (Windows 11, Node 22.12)

**Svit för svit**
- `pnpm test`: 65 filer, 487 tester gröna och 2 som bara körs på Linux hoppas över. Två körningar i rad gav samma resultat, utan instabila tester.
- `pnpm typecheck`: ren.
- `pnpm test:release`: 12 av 12. Proven bygger paketet, kör `npm pack` och installerar tarballen offline i en tom mapp. Där körs `scan`, `npx mapskill --version` och `claude plugin validate`.
- `pnpm test:e2e`: 10 av 10 i Edge.

**Prestanda med 500 genererade filer**
- `scan` med det paketerade CLI:t tar cirka 1 s. Gränsen är 20 s.
- Från filändring till delta i webbläsaren går det 0,5 s. Gränsen är 2 s.

**Paketet**
- npm-tarballen är 2,1 MB (12,7 MB uppackad) och innehåller 31 filer.
- Inga körtidsberoenden.

## Kontroll för hand

**Installation**
- `claude plugin validate release` och `release/mapskill`: godkända. Den enda varningen är att pluginet saknar ikon.
- Den lokala marknadsplatsen installerades i en isolerad konfigurationsmapp (`CLAUDE_CONFIG_DIR`): `marketplace add`, sedan `install mapskill@mapskill-local`. `plugin list` visar version 0.4.0, påslagen.

**Riktig Claude-session (`claude -p`)**
- Sessionen kördes med `--plugin-dir release/mapskill` i en kopia av `half-saas`.
- SessionStart startade daemonen. Claude anropade `map_overview` och svarade med projektets sex zoner.
- Mätfilen fick en rad: `{"d":"2026-11-02","e":"session","p":"4d70a132"}`, utan sökväg.
- Slutgranskaren körde `/mapskill:stats` och `/mapskill:lock` live med samma uppsättning. `${CLAUDE_PLUGIN_ROOT}`, `Bash(node *)` och `$ARGUMENTS` fungerade.

**Kartan från paketet**
- Kartan öppnades i webbläsarpanelen och visade zonerna.
- Ett synligt besök loggades som `map-open`.
- `stats --lang sv` gav den svenska sammanfattningen med "Öppnade kartan under vecka 2: inte än".

**Hemmappen:** `open ~` vägrar med ett tydligt meddelande och exit 1.

## Rättat efter slutgranskningen

- **Hemmappen och diskens rot:** de skyddas nu på alla vägar: `npx mapskill`, `open`, `status`, `daemon`, starten av daemonen och SessionStart-hooken.
- **Node-versionen:** guiderna säger 22.12 i stället för bara 22.
- **Testerna:** e2e-testerna skrev i den riktiga mätfilen. Nu använder alla tester en tillfällig `MAPSKILL_HOME`, och sviterna fallerar om den riktiga filen ändras. Den förorenade filen, med tre rader från testerna, är borttagen.
- **Kartbesök:** ett besök räknas bara när kartan syns. Webbläsaren skickar `seen` när fliken blir synlig, och en återanslutning i bakgrunden räknas inte. `DAEMON_VERSION` är nu 0.4.0.
- **Ett test lämnade en daemon kvar:** testet där två processer startar samtidigt. Det städar nu även efter förloraren.

## Inte provat här

- **macOS:** körs först i CI när repot finns på GitHub (`.github/workflows/ci.yml`, med Windows, macOS och Linux).
- **Publik installation:** `/plugin marketplace add Saccor/mapskill` med npm-källan kräver att paketet är publicerat. Stegen finns i [releaselistan](../../release-checklist.md).
- **Testanvändarna själva:** 3–5 personer i två veckor. Guiden finns i [testers/guide-sv.md](../../testers/guide-sv.md).
