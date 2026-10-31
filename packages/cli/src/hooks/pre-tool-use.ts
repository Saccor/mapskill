// packages/cli/src/hooks/pre-tool-use.ts
import path from 'node:path';
import { findLock, readLocks } from '../locks';
import { findProjectRoot, toProjectRel } from '../project-path';
import { editedFile } from './input';
import { ALLOW, type HookHandler, type HookResult } from './types';

function check(root: string, file: string): HookResult | null {
  const rel = toProjectRel(root, file);
  if (rel === null) return null;
  const read = readLocks(root);
  if (!read.ok) {
    return {
      exitCode: 2,
      stderr:
        `Mapskill cannot read .mapskill/locks.json (${read.error}), so it cannot tell which files the user locked. ` +
        `Ask the user before changing ${rel}, and ask them to fix or delete that file.\n`,
    };
  }
  const lock = findLock(read.locks, rel);
  if (!lock) return null;
  return {
    exitCode: 2,
    stderr:
      `The user locked "${lock.label ?? lock.path}" in Mapskill, and ${rel} is part of it. Do not change it. ` +
      `Ask the user first. To unlock, the user can run: mapskill unlock "${path.join(root, lock.path)}" ` +
      `— or remove the entry from .mapskill/locks.json.\n`,
  };
}

/**
 * Blocks edits to files the user locked. Works without the daemon: it reads .mapskill/locks.json directly.
 * Checks the hook's project root and, when the file belongs to a nested package, that package's root too, because
 * `mapskill lock` stores locks in the nearest package root.
 */
export const preToolUse: HookHandler = async ({ input, root }) => {
  const file = editedFile(input);
  if (!file) return ALLOW;
  const roots = [root];
  const own = findProjectRoot(path.dirname(path.resolve(root, file)));
  if (own !== root) roots.push(own);
  for (const r of roots) {
    const blocked = check(r, file);
    if (blocked) return blocked;
  }
  return ALLOW;
};
