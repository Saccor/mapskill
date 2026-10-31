import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { addLocks, readLocks, removeLocks } from './locks';
import { findProjectRoot } from './project-path';

type Write = (s: string) => void;
const stdout: Write = (s) => process.stdout.write(s);

type Env = Record<string, string | undefined>;

/** Where relative paths start: pnpm runs scripts in the repo folder but sets INIT_CWD to where the user typed the command. */
const baseDir = (cwd: string, env: Env): string => env.INIT_CWD || cwd;

/** The project that owns `abs`: for a folder that exists, the folder's own project; otherwise the one around the file. */
function projectOf(abs: string): string {
  try {
    if (fs.statSync(abs).isDirectory()) return findProjectRoot(abs);
  } catch {
    // a file that does not exist yet
  }
  return findProjectRoot(path.dirname(abs));
}

function parse(argv: string[], cwd: string, env: Env): { groups: Map<string, string[]>; count: number; label?: string } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { label: { type: 'string' } },
  });
  const groups = new Map<string, string[]>();
  for (const p of positionals) {
    const abs = path.resolve(baseDir(cwd, env), p);
    const root = projectOf(abs);
    groups.set(root, [...(groups.get(root) ?? []), abs]);
  }
  return { groups, count: positionals.length, label: values.label };
}

/** `mapskill lock <path...> [--label text]`: Claude must ask the user before changing these files or folders. */
export function runLock(argv: string[], cwd = process.cwd(), write: Write = stdout, env: Env = process.env): number {
  const { groups, count, label } = parse(argv, cwd, env);
  if (count === 0) {
    write('Usage: mapskill lock <file or folder...> [--label text]\n');
    return 1;
  }
  try {
    for (const [root, paths] of groups) {
      write(`Project: ${root}
`);
      const read = readLocks(root);
      const before = new Set(read.ok ? read.locks.map((l) => l.path) : []);
      for (const l of addLocks(root, paths, label)) if (!before.has(l.path)) write(`Locked ${l.path}
`);
    }
    return 0;
  } catch (err) {
    write(`${(err as Error).message}
`);
    return 1;
  }
}

/** `mapskill unlock <path...>` */
export function runUnlock(argv: string[], cwd = process.cwd(), write: Write = stdout, env: Env = process.env): number {
  const { groups, count } = parse(argv, cwd, env);
  if (count === 0) {
    write('Usage: mapskill unlock <file or folder...>\n');
    return 1;
  }
  try {
    for (const [root, paths] of groups) {
      write(`Project: ${root}
`);
      const left = removeLocks(root, paths);
      write(`${left.length} lock${left.length === 1 ? '' : 's'} left
`);
    }
    return 0;
  } catch (err) {
    write(`${(err as Error).message}
`);
    return 1;
  }
}

/** `mapskill locks [dir]`: lists the locks of the project that contains `dir`. */
export function runLocks(argv: string[], cwd = process.cwd(), write: Write = stdout, env: Env = process.env): number {
  const root = findProjectRoot(path.resolve(baseDir(cwd, env), argv[0] ?? '.'));
  const read = readLocks(root);
  if (!read.ok) {
    write(`${read.error}\n`);
    return 1;
  }
  if (read.locks.length === 0) write('No locks\n');
  for (const l of read.locks) write(`${l.path}${l.label ? ` (${l.label})` : ''}\n`);
  return 0;
}
