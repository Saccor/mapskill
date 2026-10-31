import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { addLocks, findLock, lockPathFor, readLocks, removeLocks, type Lock } from './locks';
import { canonicalRoot } from './project-path';

const project = (): string =>
  canonicalRoot(tmpProject({ 'package.json': '{}', 'lib/pay/charge.ts': '', 'lib/a.ts': '' }));
const lock = (p: string): Lock => ({ path: p, lockedAt: 1 });

describe('locks', () => {
  it('reads a missing file as no locks', () => {
    expect(readLocks(project())).toEqual({ ok: true, locks: [] });
  });

  it('reports a broken file as an error', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.mapskill'), { recursive: true });
    fs.writeFileSync(path.join(root, '.mapskill', 'locks.json'), '{ nope');
    const read = readLocks(root);
    expect(read.ok).toBe(false);
  });

  it('matches files exactly and folders by prefix', () => {
    const locks = [lock('lib/a.ts'), lock('lib/pay/')];
    expect(findLock(locks, 'lib/a.ts')?.path).toBe('lib/a.ts');
    expect(findLock(locks, 'lib/a.tsx')).toBeUndefined();
    expect(findLock(locks, 'lib/pay/charge.ts')?.path).toBe('lib/pay/');
    expect(findLock(locks, 'lib/pay/new/file.ts')?.path).toBe('lib/pay/');
    expect(findLock(locks, 'lib/payment.ts')).toBeUndefined();
  });

  it.runIf(process.platform === 'win32')('ignores letter case on Windows', () => {
    expect(findLock([lock('lib/pay/')], 'LIB/Pay/x.ts')?.path).toBe('lib/pay/');
  });

  it('adds folders with a trailing slash, skips duplicates and removes', () => {
    const root = project();
    expect(lockPathFor(root, path.join(root, 'lib', 'pay'))).toBe('lib/pay/');
    expect(lockPathFor(root, path.join(root, '..'))).toBeNull();
    addLocks(root, [path.join(root, 'lib', 'pay'), path.join(root, 'lib', 'a.ts')], 'Betalning');
    const after = addLocks(root, [path.join(root, 'lib', 'a.ts')]);
    expect(after.map((l) => l.path)).toEqual(['lib/pay/', 'lib/a.ts']);
    expect(after[0].label).toBe('Betalning');
    const read = readLocks(root);
    expect(read.ok && read.locks.map((l) => l.path)).toEqual(['lib/pay/', 'lib/a.ts']);
    expect(removeLocks(root, [path.join(root, 'lib', 'pay')]).map((l) => l.path)).toEqual(['lib/a.ts']);
  });

  it('refuses a path outside the project', () => {
    const root = project();
    expect(() => addLocks(root, [path.join(root, '..', 'elsewhere.ts')])).toThrow(/outside/i);
  });
});
