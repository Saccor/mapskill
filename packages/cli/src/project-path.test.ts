import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { canonicalRoot, findProjectRoot, toProjectRel } from './project-path';

describe('project paths', () => {
  it('maps files inside the root and rejects files outside it', () => {
    const root = canonicalRoot(tmpProject({ 'package.json': '{}', 'lib/a.ts': '' }));
    expect(toProjectRel(root, path.join(root, 'lib', 'a.ts'))).toBe('lib/a.ts');
    expect(toProjectRel(root, 'lib/gone.ts')).toBe('lib/gone.ts');
    expect(toProjectRel(root, path.join(root, '..', 'x.ts'))).toBeNull();
    expect(toProjectRel(root, root)).toBeNull();
  });

  it.runIf(process.platform === 'win32')('uses the on-disk letter case on Windows', () => {
    const root = canonicalRoot(tmpProject({ 'package.json': '{}', 'lib/a.ts': '' }));
    expect(toProjectRel(root, path.join(root, 'LIB', 'A.TS'))).toBe('lib/a.ts');
  });

  it('finds the nearest folder with a package.json', () => {
    const root = tmpProject({ 'package.json': '{}', 'app/x/page.tsx': '' });
    expect(findProjectRoot(path.join(root, 'app', 'x'))).toBe(canonicalRoot(root));
    const bare = fs.mkdtempSync(path.join(path.dirname(root), 'mapskill-bare-'));
    expect(findProjectRoot(bare)).toBe(canonicalRoot(bare));
  });
});
