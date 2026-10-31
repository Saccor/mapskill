import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { runLock, runLocks, runUnlock } from './lock-commands';
import { readLocks } from './locks';
import { canonicalRoot } from './project-path';

const capture = (): { out: string[]; write: (s: string) => void } => {
  const out: string[] = [];
  return { out, write: (s) => void out.push(s) };
};

describe('lock commands', () => {
  it('locks paths relative to the current folder, lists and unlocks them', () => {
    const root = canonicalRoot(tmpProject({ 'package.json': '{}', 'lib/pay/charge.ts': '', 'lib/a.ts': '' }));
    const cwd = path.join(root, 'lib');
    const a = capture();
    expect(runLock(['pay', 'a.ts', '--label', 'Betalning'], cwd, a.write)).toBe(0);
    expect(a.out[0]).toBe(`Project: ${root}
`);
    expect(a.out.join('')).toContain('Locked lib/pay/');
    const read = readLocks(root);
    expect(read.ok && read.locks.map((l) => l.path)).toEqual(['lib/pay/', 'lib/a.ts']);

    const b = capture();
    expect(runLocks([], cwd, b.write)).toBe(0);
    expect(b.out.join('')).toContain('lib/pay/ (Betalning)');

    const u = capture();
    expect(runUnlock(['pay'], cwd, u.write)).toBe(0);
    expect(u.out[0]).toBe(`Project: ${root}
`);
    const after = readLocks(root);
    expect(after.ok && after.locks.map((l) => l.path)).toEqual(['lib/a.ts']);
  });

  it('fails with a message for a path outside the project and without paths', () => {
    const root = canonicalRoot(tmpProject({ 'package.json': '{}' }));
    const a = capture();
    expect(runLock([path.join(root, '..', 'x.ts')], root, a.write)).toBe(1);
    expect(a.out.join('')).toMatch(/outside/i);
    expect(runLock([], root, capture().write)).toBe(1);
  });
});
