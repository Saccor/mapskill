// packages/cli/src/unsafe-root.ts
// Node built-ins only: hooks import this, and they must not load @mapskill/core.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const UNSAFE_ROOT_MESSAGE =
  'Mapskill does not map your home folder or a disk root. Open Claude Code or the terminal in your project folder.';

function normalize(p: string): string {
  const abs = path.resolve(p);
  let real = abs;
  try {
    real = fs.realpathSync.native(abs);
  } catch {
    // a folder that does not exist keeps its given spelling
  }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * True for the home folder and for a disk root: walking and watching either would take the whole disk.
 * `home` is injectable for tests. Case-insensitive on Windows.
 */
export function isUnsafeRoot(dir: string, home: string = os.homedir()): boolean {
  const resolved = path.resolve(dir);
  if (path.parse(resolved).root === resolved) return true;
  const target = normalize(resolved);
  if (path.parse(target).root === target) return true;
  return target === normalize(home);
}
