# Testa Mapskill: guide för testare

Tack för att du testar! Mapskill är ett tillägg (plugin) till Claude Code. Det visar din app som en karta i webbläsaren och hjälper Claude att hålla ordning på koden.

Testet pågår i två veckor. Använd Claude Code som vanligt, och öppna kartan när du själv vill. Du behöver inte göra något speciellt. Vi vill veta hur det går när du använder den på riktigt.

## 1. Det här behöver du

- **Claude Code**, som du redan använder.
- **Node.js** version 22.12 eller nyare. Node.js är programmet som kör Mapskill i bakgrunden.
  - Kolla om du har det: skriv `node -v` i en terminal. Om det står `v22.12` eller högre (till exempel `v22.14` eller `v24`) är allt klart.
  - Annars laddar du ner "LTS" från [nodejs.org](https://nodejs.org) och installerar som vanligt. LTS betyder den stabila versionen. Starta om Claude Code efteråt.
- **Ett projekt** att jobba i. Bäst är en Next.js-app, men andra JavaScript- och TypeScript-projekt fungerar också.

## 2. Installera

Öppna Claude Code i din projektmapp och skriv:

    /plugin marketplace add Saccor/mapskill

Det lägger till Mapskills "marknadsplats", alltså listan där pluginet finns. Skriv sedan:

    /plugin install mapskill@mapskill-marketplace

Skriv till sist `/reload-plugins`, eller starta en ny session.

**Om det inte fungerar på Windows:** Claude Code försöker först hämta via SSH, ett inloggningssätt som kräver en särskild nyckel. Gör så här i stället:
1. Stäng Claude Code.
2. Öppna PowerShell och skriv `setx CLAUDE_CODE_PLUGIN_PREFER_HTTPS 1`.
3. Öppna Claude Code igen och upprepa kommandona ovan.

## 3. Använd det

| Skriv i Claude Code | Vad som händer |
|---|---|
| `/mapskill:map` | Kartan över ditt projekt öppnas i webbläsaren |
| `/mapskill:lock app/page.tsx` | Filen låses. Claude måste fråga dig innan den ändras |
| `/mapskill:unlock app/page.tsx` | Låset tas bort |
| `/mapskill:stats` | Visar hur du har använt Mapskill, som text du skickar till oss |

**Kartan** visar appen i zoner: sidor, server, byggstenar, data och delade hjälpare. Klicka på en ruta för att se vad den gör.
- När Claude ändrar något pulserar rutan.
- En siffra som `6/10` på en ruta betyder att Mapskill har hittat något att förbättra där, till exempel kopierad kod.

**Mål:** välj vad du bygger i målväljaren högst upp, till exempel "SaaS med inloggning och betalning".
- Det som saknas syns som streckade rutor ("spöknoder").
- Klicka på en spöknod och tryck **Bygg med Claude**. Då skickas en färdig beställning med ditt nästa meddelande till Claude.

**Medan du jobbar** gör Mapskill två saker i bakgrunden:
- Claude får en påminnelse om den har kopierat kod som redan fanns.
- Claude stoppas från att ändra filer du har låst.

## 4. Skicka resultatet till oss

**Dag 7 och dag 14:** skriv `/mapskill:stats` i Claude Code och kopiera texten till oss, till exempel i ett mejl eller ett meddelande.

Texten innehåller bara siffror: vilka dagar du använde Claude med Mapskill, vilka dagar du öppnade kartan och hur många gånger du tryckte på knapparna. Den innehåller inga filnamn, ingen kod och inget om ditt projekt.

Berätta gärna med egna ord också:
- Vad var bra?
- Vad var förvirrande?
- När öppnade du kartan, och varför?

## 5. Det här sparas, och så tar du bort det

Mapskill skickar ingenting över internet. Det sparar bara på din dator:

- **`.mapskill/` i projektmappen:** kartans läge, dina lås och ditt mål.
- **`.mapskill/usage.jsonl` i din hemmapp:** datum och vilka knappar som användes. Hemmappen är `C:\Users\<namn>` på Windows och `/Users/<namn>` på Mac.

**Ta bort Mapskill:**
1. Skriv `/plugin uninstall mapskill@mapskill-marketplace`.
2. Ta bort mapparna ovan om du vill.

## Om något krånglar

- **"node" hittas inte:** installera Node.js (se steg 1) och starta om Claude Code.
- **Kartan öppnas inte:** `/mapskill:map` visar en adress. Kopiera den till webbläsaren.
- **Något annat:** skicka en skärmbild till oss. Det är också värdefullt testresultat.
