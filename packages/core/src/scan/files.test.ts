import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixture } from '../test-helpers';
import { listSourceFiles } from './files';

describe('listSourceFiles', () => {
  it('lists code files sorted with forward slashes', () => {
    expect(listSourceFiles(fixture('clean-app'))).toEqual([
      'app/api/profile/route.ts',
      'app/layout.tsx',
      'app/page.tsx',
      'components/ProfileCard.tsx',
      'lib/profiles.ts',
      'lib/supabase.ts',
    ]);
  });

  it('skips node_modules, declaration files and .gitignore entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-files-'));
    const write = (rel: string, text = 'export {};') => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    };
    write('a.ts');
    write('ignored/b.ts');
    write('node_modules/c/index.ts');
    write('types.d.ts');
    write('README.md', '# x');
    write('.gitignore', 'ignored/\n');
    expect(listSourceFiles(dir)).toEqual(['a.ts']);
  });
});

describe('listSourceFiles skip rules', () => {
  it('skips public/ and root-only dist/build/out, but not nested ones', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-files2-'));
    const write = (rel: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'export {};');
    };
    for (const rel of ['public/sw.js', 'dist/a.js', 'build/a.js', 'out/a.js', 'src/build/keep.ts', 'src/out/keep2.ts', 'pkg/node_modules/x.ts', 'src/coverage/z.ts', 'src/public/ok.ts']) write(rel);
    expect(listSourceFiles(dir)).toEqual(['src/build/keep.ts', 'src/out/keep2.ts', 'src/public/ok.ts']);
  });
});
