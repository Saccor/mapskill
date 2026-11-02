# Släppa Mapskill till testanvändare

Det här kan bara du göra, eftersom stegen publicerar saker under ditt namn. Allt annat är klart och provat lokalt.

## En gång

1. **Skapa repot på GitHub** med namnet `Saccor/mapskill`, publikt så att testarna kan hämta marknadsplatsen. Marknadsplatsfilen ligger i `.claude-plugin/marketplace.json` i repots rot.

       git remote add origin https://github.com/Saccor/mapskill.git
       git push -u origin master

2. **Vänta på CI:** öppna fliken Actions på GitHub. Jobben `test` på Windows, macOS och Linux och `e2e` ska bli gröna. Det är den första riktiga kontrollen på macOS.

3. **Logga in på npm:** skapa ett konto på npmjs.com om du saknar ett, och skriv sedan:

       npm login

## Varje version

1. **Höj versionen** i `packages/cli/package.json` (just nu `0.4.0`). Claude Code uppdaterar bara pluginet när versionen ändras.
2. **Bygg och prova:**

       pnpm install
       pnpm build:release
       pnpm test:release

3. **Publicera** på npm. Paketet är både CLI:t och pluginet:

       cd release/mapskill
       npm publish

4. **Tagga och pusha:**

       git tag v0.4.0
       git push --tags

5. **Prova som en testare** på en annan dator, helst en Mac: följ [testers/guide-sv.md](testers/guide-sv.md) från början.

## Prova lokalt utan att publicera

Den här vägen installerar från den lokala byggda mappen i stället för npm:

    pnpm build:release
    claude plugin marketplace add <sökväg till repot>/release
    claude plugin install mapskill@mapskill-local
