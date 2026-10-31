# M3: manuell session med Claude Code

Datum: 2026-10-31. Claude Code 2.1.270, Windows 11. Pluginet byggt med `pnpm build:plugin` från grenen `m3-plugin`.

## Uppställning

Två kopior av `fixtures/messy-app` i en tmp-mapp, var och en med ett eget git-repo så att ändringarna går att jämföra. Claude kördes utan interaktion (`claude -p`) med `--permission-mode acceptEdits`, en gång med `--plugin-dir <repo>/plugin` och en gång utan.

Första försöket misslyckades med "OAuth session expired". Orsaken var inte inloggningen. Processen ärvde miljövariabler (`CLAUDE_*`, `ANTHROPIC_*`) från Claude-sessionen som startade testet. När variablerna togs bort fungerade inloggningen. Pluginet laddades och startade daemonen även vid det misslyckade försöket.

## Prov 1: datumformaterare

Fråga: "Add a small helper that formats an order's created date as YYYY-MM-DD, and use it on the home page."

| | Utan plugin | Med plugin |
|---|---|---|
| Ny formaterare skapad | Nej | Nej |
| Ändring | Tog bort det dubbla anropet `formatDay` i `app/page.tsx` och behöll `formatDate` | Exakt samma ändring |
| Nämnde dubbletterna `formatDateCopy` och `formatDay` | Ja, erbjöd sig att ta bort dem | Ja, erbjöd sig att ta bort dem |

Båda återanvände `formatDate`. Provet skiljer alltså inte på med och utan plugin. Hemsidan i `messy-app` importerar redan `formatDate`, så Claude hittar den direkt med en vanlig sökning. Stop-hooken hade inget att rapportera eftersom ingen ny kod skrevs.

Slutsats: provet bekräftar inte att pluginet ökar återanvändningen. Det visar bara att pluginet inte stör. För att mäta effekten behövs en fixture där den befintliga hjälpfunktionen inte redan används i filen Claude ändrar, och flera varv. Det hör till specens mått (10 testvarv) i M6.

## Prov 2: låset

`lib/date.ts` låstes med `pnpm mapskill lock <absolut sökväg> --label Datum`. Fråga i kopian med plugin: "Rename formatDate to formatIsoDate everywhere."

Det här gjorde Claude:
- Sökte, läste filerna och skrev en tabell över de två ställen som berörs. Den markerade `lib/date.ts` som "locked file (Datum)".
- Gjorde ingen ändring och frågade: "May I edit `lib/date.ts` to rename the export to `formatIsoDate`?"
- Ändrade inte heller `app/page.tsx` ensam, eftersom det skulle ha gjort bygget trasigt.

Låset höll. Claude visste om låset från SessionStart-kontexten ("Locked by the user …") och försökte aldrig ändra filen. Därför prövades själva blockeringen i PreToolUse inte i den här sessionen. Den prövas av `e2e.test.ts` och `bundle.test.ts` (exitkod 2 med förklaring).

## Kontroller

- Strömmen från `--output-format stream-json` visar att Claude Code laddade pluginet (`mapskill@inline`, version 0.2.0) och att SessionStart-hooken gav sin kontext.
- De fyra MCP-verktygen fanns: `mcp__plugin_mapskill_mapskill__find_similar`, `map_overview`, `node_details` och `turn_findings`. Claude anropade inget av dem i de här proven.
- `.mapskill/` i kopian med plugin innehöll `cache.json`, `daemon.log` och `locks.json`. Någon `log.txt` fanns inte, alltså gav inga hooks fel. Daemonen startade på 109 ms och stoppades rent.

## Att följa upp

- En fixture eller ett prov där återanvändning inte är uppenbar, för att mäta om `find_similar` och Stop-hooken gör skillnad (M6).
- Claude anropade inte `find_similar` trots skillen. Det kan bero på att svaret redan syntes i filen. Det bör följas i M6:s testvarv.
- När Claude Code startas från en annan Claude-session ärver den miljövariabler som kan ge fel inloggning. Det spelar ingen roll för vanliga användare, men testskript måste rensa variablerna.
