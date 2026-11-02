// packages/cli/src/stats-command.ts
import { parseArgs } from 'node:util';
import { detectLang } from './start-command';
import { readUsage, summarize, type UsageLine, type UsageSummary } from './usage';

type Lang = 'en' | 'sv';

const TEXT = {
  en: {
    nothing: 'Nothing to show yet: Mapskill has not been used on this computer.',
    intro: 'Nothing has been sent anywhere. These numbers come from a small file on this computer. You can copy this text and send it to us.',
    since: (s: UsageSummary) => `First used: ${s.firstDay} (day ${s.days})`,
    sessions: (n: number) => `Days with a Claude Code session: ${n}`,
    maps: (n: number) => `Days you opened the map: ${n}`,
    requests: (r: UsageSummary['requests']) => `Requests from the map: ${r.ask} questions, ${r.fix} fixes, ${r.build} builds`,
    reminders: (n: number) => `Reminders Mapskill gave Claude: ${n}`,
    projects: (n: number) => `Projects: ${n}`,
    week: (w: UsageSummary['weeks'][number]) => `Week ${w.week}: ${w.sessionDays} session days, ${w.mapDays} map days`,
    weekTwo: (v: boolean | null) => `Opened the map in week 2: ${v === null ? 'not yet' : v ? 'yes' : 'no'}`,
  },
  sv: {
    nothing: 'Inget att visa än: Mapskill har inte använts på den här datorn.',
    intro: 'Inget har skickats någonstans. Siffrorna kommer från en liten fil på den här datorn. Du kan kopiera texten och skicka den till oss.',
    since: (s: UsageSummary) => `Första användning: ${s.firstDay} (dag ${s.days})`,
    sessions: (n: number) => `Dagar med en Claude Code-session: ${n}`,
    maps: (n: number) => `Dagar du öppnade kartan: ${n}`,
    requests: (r: UsageSummary['requests']) => `Förfrågningar från kartan: ${r.ask} frågor, ${r.fix} rättningar, ${r.build} byggen`,
    reminders: (n: number) => `Påminnelser Mapskill gav Claude: ${n}`,
    projects: (n: number) => `Projekt: ${n}`,
    week: (w: UsageSummary['weeks'][number]) => `Vecka ${w.week}: ${w.sessionDays} sessionsdagar, ${w.mapDays} kartdagar`,
    weekTwo: (v: boolean | null) => `Öppnade kartan under vecka 2: ${v === null ? 'inte än' : v ? 'ja' : 'nej'}`,
  },
} as const;

export function formatStats(s: UsageSummary, lang: Lang): string {
  const t = TEXT[lang];
  return [
    t.intro,
    '',
    t.since(s),
    t.sessions(s.sessionDays),
    t.maps(s.mapDays),
    t.requests(s.requests),
    t.reminders(s.reminders),
    t.projects(s.projects),
    ...s.weeks.map(t.week),
    t.weekTwo(s.weekTwoMap),
    '',
  ].join('\n');
}

/** `mapskill stats [--lang en|sv] [--json]`: what the local usage log says, as text to copy and send to us. */
export async function runStats(
  argv: string[],
  deps: { env?: NodeJS.ProcessEnv; now?: Date; write?: (s: string) => void } = {},
): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { lang: { type: 'string' }, json: { type: 'boolean', default: false } }, strict: false });
  const lang: Lang = values.lang === 'sv' || values.lang === 'en' ? values.lang : detectLang();
  const write = deps.write ?? ((s: string) => void process.stdout.write(s));
  const lines: UsageLine[] = readUsage(deps.env);
  if (lines.length === 0) {
    write(values.json ? `${JSON.stringify({ firstDay: null })}\n` : `${TEXT[lang].nothing}\n`);
    return 0;
  }
  const summary = summarize(lines, deps.now ?? new Date());
  write(values.json ? `${JSON.stringify(summary, null, 2)}\n` : formatStats(summary, lang));
  return 0;
}
