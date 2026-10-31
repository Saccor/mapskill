import fs from 'node:fs';
import path from 'node:path';

/** The on-disk spelling of `p` (letter case, junctions and symlinks resolved), or null when it does not exist. */
export function realPath(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/** Absolute project root in its on-disk spelling (or as given when the folder does not exist). */
export function canonicalRoot(dir: string): string {
  const abs = path.resolve(dir);
  return realPath(abs) ?? abs;
}

/** On-disk spelling of `abs`; for a path that does not exist yet, its nearest existing ancestor resolved plus the rest. */
function resolveNew(abs: string): string {
  const rest: string[] = [];
  for (let cur = abs; ; ) {
    const real = realPath(cur);
    if (real !== null) return rest.length === 0 ? real : path.join(real, ...rest);
    const parent = path.dirname(cur);
    if (parent === cur) return abs;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
}

/**
 * Project-relative path with '/' separators, or null when `file` lies outside the project (or is the root itself).
 * `root` must be canonical. An existing file is resolved to its on-disk spelling first, so a hook path with other
 * letter case on Windows still maps to the path the graph uses. A path that does not exist yet is resolved through its nearest existing ancestor, so a new file addressed through a link maps too.
 */
export function toProjectRel(root: string, file: string): string | null {
  const abs = path.resolve(root, file);
  const rel = path.relative(root, resolveNew(abs)).split(path.sep).join('/');
  if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return null;
  return rel;
}

/** The nearest folder at or above `start` that has a package.json, or `start` itself when none has. Canonical. */
export function findProjectRoot(start: string): string {
  const first = canonicalRoot(start);
  for (let dir = first; ; ) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return first;
    dir = parent;
  }
}
