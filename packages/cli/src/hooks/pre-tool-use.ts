// packages/cli/src/hooks/pre-tool-use.ts
import { findLock, readLocks } from '../locks';
import { toProjectRel } from '../project-path';
import { editedFile } from './input';
import { ALLOW, type HookHandler } from './run';

/** Blocks edits to files the user locked. Works without the daemon: it reads .mapskill/locks.json directly. */
export const preToolUse: HookHandler = async ({ input, root }) => {
  const file = editedFile(input);
  if (!file) return ALLOW;
  const rel = toProjectRel(root, file);
  if (rel === null) return ALLOW;
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
  if (!lock) return ALLOW;
  return {
    exitCode: 2,
    stderr:
      `The user locked "${lock.label ?? lock.path}" in Mapskill, and ${rel} is part of it. Do not change it. ` +
      `Ask the user first; they can unlock it in the Mapskill map or with: mapskill unlock ${lock.path}\n`,
  };
};
