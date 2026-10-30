import type { Text } from '../model/types';

export const msg = {
  exactDuplicate: (names: string): Text => ({
    en: `These do exactly the same thing: ${names}. Are all of them needed?`,
    sv: `Dessa gör exakt samma sak: ${names}. Behövs alla?`,
  }),
  renamedDuplicate: (names: string): Text => ({
    en: `Same code with different names: ${names}. Merge them?`,
    sv: `Samma kod med olika namn: ${names}. Slå ihop?`,
  }),
  nearDuplicate: (names: string, percent: number): Text => ({
    en: `These are ${percent}% alike: ${names}. Could they be one?`,
    sv: `Dessa är ${percent} % lika: ${names}. Kan de bli en?`,
  }),
  unusedExport: (name: string): Text => ({
    en: `No other file uses ${name}. Should it go?`,
    sv: `Ingen annan fil använder ${name}. Ska den bort?`,
  }),
  orphanFile: (file: string): Text => ({
    en: `${file} is not used anywhere.`,
    sv: `${file} används inte någonstans.`,
  }),
  complexFunction: (name: string, score: number): Text => ({
    en: `${name} is hard to follow (complexity ${score}). Split it up?`,
    sv: `${name} är svår att följa (komplexitet ${score}). Dela upp?`,
  }),
  longFile: (file: string, lines: number): Text => ({
    en: `${file} has ${lines} lines and does many things.`,
    sv: `${file} har ${lines} rader och gör många saker.`,
  }),
  clientTouchesServer: (file: string, what: string): Text => ({
    en: `${file} runs in the browser but uses ${what}, which belongs on the server.`,
    sv: `${file} körs i webbläsaren men använder ${what}, som hör hemma på servern.`,
  }),
  pageTouchesTable: (file: string, tables: string): Text => ({
    en: `${file} talks directly to the database (${tables}) from the browser. Usually this goes through a server function.`,
    sv: `${file} pratar direkt med databasen (${tables}) från webbläsaren. Vanligtvis går det via en serverfunktion.`,
  }),
  circularImport: (files: string[]): Text => ({
    en: `These files use each other in a circle: ${files.join(', ')}.`,
    sv: `Dessa filer använder varandra i en cirkel: ${files.join(', ')}.`,
  }),
  hardcodedSecret: (file: string, preview: string): Text => ({
    en: `This looks like a secret key written directly in ${file} (${preview}).`,
    sv: `Det här ser ut som en hemlig nyckel direkt i ${file} (${preview}).`,
  }),
  swallowedError: (file: string, line: number): Text => ({
    en: `Errors are silenced in ${file}:${line}. Nobody will notice if something breaks.`,
    sv: `Fel tystas i ${file}:${line}. Ingen märker om något går sönder.`,
  }),
};
