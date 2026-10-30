import fs from 'node:fs';
import path from 'node:path';

export const MAPSKILL_DIR = '.mapskill';

export function mapskillPath(root: string, name: string): string {
  return path.join(root, MAPSKILL_DIR, name);
}

export function ensureMapskillDir(root: string): void {
  fs.mkdirSync(path.join(root, MAPSKILL_DIR), { recursive: true });
}

/** Adds .mapskill/ to an existing .gitignore, once. Returns true when the file was changed. Never creates a .gitignore. */
export function ensureGitignore(root: string): boolean {
  const file = path.join(root, '.gitignore');
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  if (/^\/?\.mapskill(\/\*?)?\s*$/m.test(text)) return false;
  const separator = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${separator}\n# Mapskill (local map data)\n.mapskill/*\n!.mapskill/goal.yaml\n`);
  return true;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Writes JSON to a temporary file and renames it over the target, so readers never see half a file. Retries briefly when Windows holds the target open. */
export function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 4) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      sleepSync(20);
    }
  }
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}
