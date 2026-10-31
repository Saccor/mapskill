import path from 'node:path';
import { parseArgs } from 'node:util';
import { addLocks, readLocks, removeLocks } from './locks';
import { findProjectRoot } from './project-path';

type Write = (s: string) => void;
const stdout: Write = (s) => process.stdout.write(s);

function parse(argv: string[], cwd: string): { root: string; paths: string[]; label?: string } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { label: { type: 'string' } },
  });
  return { root: findProjectRoot(cwd), paths: positionals.map((p) => path.resolve(cwd, p)), label: values.label };
}

/** `mapskill lock <path...> [--label text]`: Claude must ask the user before changing these files or folders. */
export function runLock(argv: string[], cwd = process.cwd(), write: Write = stdout): number {
  const { root, paths, label } = parse(argv, cwd);
  if (paths.length === 0) {
    write('Usage: mapskill lock <file or folder...> [--label text]\n');
    return 1;
  }
  try {
    const read = readLocks(root);
    const before = new Set(read.ok ? read.locks.map((l) => l.path) : []);
    for (const l of addLocks(root, paths, label)) if (!before.has(l.path)) write(`Locked ${l.path}\n`);
    return 0;
  } catch (err) {
    write(`${(err as Error).message}\n`);
    return 1;
  }
}

/** `mapskill unlock <path...>` */
export function runUnlock(argv: string[], cwd = process.cwd(), write: Write = stdout): number {
  const { root, paths } = parse(argv, cwd);
  if (paths.length === 0) {
    write('Usage: mapskill unlock <file or folder...>\n');
    return 1;
  }
  try {
    const left = removeLocks(root, paths);
    write(`${left.length} lock${left.length === 1 ? '' : 's'} left\n`);
    return 0;
  } catch (err) {
    write(`${(err as Error).message}\n`);
    return 1;
  }
}

/** `mapskill locks [dir]`: lists the locks of the project that contains `dir`. */
export function runLocks(argv: string[], cwd = process.cwd(), write: Write = stdout): number {
  const root = findProjectRoot(path.resolve(cwd, argv[0] ?? '.'));
  const read = readLocks(root);
  if (!read.ok) {
    write(`${read.error}\n`);
    return 1;
  }
  if (read.locks.length === 0) write('No locks\n');
  for (const l of read.locks) write(`${l.path}${l.label ? ` (${l.label})` : ''}\n`);
  return 0;
}
