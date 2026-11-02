import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Write = (s: string) => void;
type Lang = 'en' | 'sv';

const PROJECT_MARKERS = ['package.json', '.git', 'pyproject.toml', 'requirements.txt', 'go.mod'];

/** True when `dir` has a project marker directly inside it. The home folder and disk roots never count. */
export function looksLikeProject(dir: string): boolean {
  const resolved = path.resolve(dir);
  if (path.parse(resolved).root === resolved) return false;
  if (path.resolve(os.homedir()) === resolved) return false;
  return PROJECT_MARKERS.some((m) => fs.existsSync(path.join(resolved, m)));
}

function detectLang(): Lang {
  const env = process.env.LC_ALL || process.env.LANG || '';
  if (/^sv/i.test(env)) return 'sv';
  if (env) return 'en';
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('sv') ? 'sv' : 'en';
  } catch {
    return 'en';
  }
}

const HELP: Record<Lang, string> = {
  en: [
    'Mapskill shows a map of your project, but this folder does not look like one.',
    '',
    '1. Go to your project folder and run `npx mapskill` again.',
    '2. Install the plugin in Claude Code with these two commands:',
    '     /plugin marketplace add Saccor/mapskill',
    '     /plugin install mapskill@mapskill-marketplace',
    '3. `npx mapskill --help` shows all commands.',
    '',
  ].join('\n'),
  sv: [
    'Mapskill visar en karta över ditt projekt, men den här mappen ser inte ut som ett projekt.',
    '',
    '1. Gå till din projektmapp och kör `npx mapskill` igen.',
    '2. Installera pluginet i Claude Code med dessa två kommandon:',
    '     /plugin marketplace add Saccor/mapskill',
    '     /plugin install mapskill@mapskill-marketplace',
    '3. `npx mapskill --help` visar alla kommandon.',
    '',
  ].join('\n'),
};

/** `mapskill` with no command: open the map for this folder if it is a project, otherwise explain what to do. */
export async function runStart(
  argv: string[],
  deps: { cwd?: string; open?: (args: string[]) => Promise<number>; write?: Write; lang?: Lang } = {},
): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  const write = deps.write ?? ((s: string) => void process.stdout.write(s));
  if (!looksLikeProject(cwd)) {
    write(HELP[deps.lang ?? detectLang()]);
    return 1;
  }
  const open = deps.open ?? (async (args: string[]) => (await import('./open-command')).runOpen(args));
  return open([cwd, ...argv]);
}
