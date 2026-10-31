import fs from 'node:fs';
import path from 'node:path';
import { ensureMapskillDir, mapskillPath, writeJsonAtomic } from './daemon/paths';
import { toProjectRel } from './project-path';

// This module must not import @mapskill/core: the PreToolUse hook loads it on every edit.

export interface Lock {
  /** Project-relative file ('lib/pay.ts') or folder ending in '/' ('lib/payments/'). */
  path: string;
  /** What the user locked, in their words ('Betalning'). Shown to Claude when an edit is refused. */
  label?: string;
  lockedAt: number;
}

export type LocksResult = { ok: true; locks: Lock[] } | { ok: false; error: string };

export function locksFile(root: string): string {
  return mapskillPath(root, 'locks.json');
}

/** Reads .mapskill/locks.json. A missing file means no locks. A broken file is an error: the lock check then fails closed. */
export function readLocks(root: string): LocksResult {
  let text: string;
  try {
    text = fs.readFileSync(locksFile(root), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, locks: [] };
    return { ok: false, error: `cannot read locks.json: ${(err as Error).message}` };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `locks.json is not valid JSON: ${(err as Error).message}` };
  }
  const list = (data as { locks?: unknown } | null)?.locks;
  if (!Array.isArray(list)) return { ok: false, error: 'locks.json has no "locks" list' };
  const locks = list.filter(
    (l): l is Lock => typeof l === 'object' && l !== null && typeof (l as Lock).path === 'string' && (l as Lock).path !== '',
  );
  return { ok: true, locks };
}

const fold = (s: string): string => (process.platform === 'win32' ? s.toLowerCase() : s);

/** The lock that covers `rel` (project-relative, '/' separators), if any. */
export function findLock(locks: Lock[], rel: string): Lock | undefined {
  const target = fold(rel);
  return locks.find((l) => {
    const p = fold(l.path);
    return p.endsWith('/') ? target.startsWith(p) : target === p;
  });
}

/** The lock path for a user-given path: project-relative, folders with a trailing '/'. Null when outside the project. */
export function lockPathFor(root: string, given: string): string | null {
  const rel = toProjectRel(root, given);
  if (rel === null) return null;
  try {
    if (fs.statSync(path.join(root, rel)).isDirectory()) return `${rel}/`;
  } catch {
    // a file that does not exist yet can still be locked
  }
  return rel;
}

function current(root: string): Lock[] {
  const read = readLocks(root);
  if (!read.ok) throw new Error(read.error);
  return read.locks;
}

function save(root: string, locks: Lock[]): void {
  ensureMapskillDir(root);
  writeJsonAtomic(locksFile(root), { version: 1, locks });
}

/** Locks the given files or folders. Returns all locks afterwards. Throws for a path outside the project. */
export function addLocks(root: string, paths: string[], label?: string): Lock[] {
  const locks = current(root);
  for (const given of paths) {
    const p = lockPathFor(root, given);
    if (p === null) throw new Error(`Outside the project: ${given}`);
    if (locks.some((l) => fold(l.path) === fold(p))) continue;
    locks.push({ path: p, ...(label ? { label } : {}), lockedAt: Date.now() });
  }
  save(root, locks);
  return locks;
}

/** Removes the locks for the given files or folders. Returns the locks that remain. */
export function removeLocks(root: string, paths: string[]): Lock[] {
  const drop = new Set(paths.map((given) => lockPathFor(root, given)).filter((p): p is string => p !== null).map(fold));
  const locks = current(root).filter((l) => !drop.has(fold(l.path)));
  save(root, locks);
  return locks;
}
