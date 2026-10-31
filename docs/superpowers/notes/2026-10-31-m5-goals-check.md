# M5: kontroll av mål och spöknoder i appens webbläsare

Datum: 2026-10-31. Pluginet byggt med `pnpm build:plugin` från grenen `m5-goals`. En kopia av `fixtures/half-saas` öppnad med `pnpm mapskill open <kopia> --no-browser` i Claude-appens webbläsarpanel.

## Vad som fungerade

- **Målväljaren:** visar "Inget mål" och de fyra målen, på engelska och efter språkbyte på svenska.
- **SaaS-målet:** valet "SaaS with login and payments" gav fyra streckade spöknoder med `+` och märket "Missing"/"Saknas" i rätt zoner:
  - Prissida i Sidor
  - API för betalning och Webhook i Server
  - Tabell för prenumerationer i Data
- **Sidhuvudet:** visade `10/14`.
- **Målpanelen:** "Visa mål" öppnade den. Den listade de tio uppfyllda punkterna med ✓ och "klar", och de fyra som saknas med ○ och "saknas", var och en med en förklaring på enkel svenska. Klick på "Prissida" i panelen valde spöknoden.
- **Spöknodens panel:** "Saknas · Sida", förklaringen, "Föreslagen plats: app/pricing/page.tsx" och knappen "Bygg med Claude".
- **Bygg med Claude:** knappen lade beställningen i kön. UserPromptSubmit-hooken lämnade den till Claude på svenska: "Lägg till Prissida (Kunderna vill se vad det kostar innan de betalar). Föreslagen plats: app/pricing/page.tsx. Återanvänd det som redan finns, till exempel /, /account, /login." Användaren fick dessutom meddelandet "Mapskill sent 1 request(s) from the map to Claude."
- **Från spöknod till riktig del:** när `app/pricing/page.tsx` skapades försvann spöknoden. Sidan `/pricing` dök upp på exakt samma plats, och sidhuvudet visade `11/14`. Ingen annan ruta flyttade sig.
- **Tema:** ljust och mörkt tema fungerar. Spöknodernas streckade ram syns i båda.

## Konstigt eller att följa upp

- Skärmläsarens senaste meddelande kan stå kvar på det språk det skrevs på efter ett språkbyte. Det syns bara för skärmläsare.
- Långa titlar på spöknoder kortas med "…" i rutan, till exempel "API för betal…". Hela titeln finns i panelen och i skärmläsarens etikett.
- Jag provade MCP-verktyget `goal_gaps` för hand med ett eget skript, men skriptet läste fel svarsrad. Verktyget prövas i stället av `packages/cli/src/mcp/server.test.ts` mot en riktig daemon på `half-saas`.
- `systemMessage` är fortfarande alltid på engelska (från M4).

## Automatiska prov

- `pnpm test`: 432 passerade, 2 hoppade över (tester som bara kan köras på Linux).
- `pnpm typecheck`: rent.
- `pnpm test:e2e`: 10 av 10 i Edge. Sex är från M4. Fyra är nya för mål, spöknoder, Bygg via hooken, att en spöknod blir en riktig ruta utan att något flyttar sig, och Escape i rätt ordning.
- Under bygget hittade slutprovet ett riktigt fel: en byggd del fick en ny plats, och delar längre ner flyttade sig. Det är rättat. Målstatusen skickas nu i samma meddelande som grafändringen, och en byggd del ärver spöknodens plats, även när den byggs i flera steg.
