import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

describe('listSourceFiles on a changing tree', () => {
  const tree = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-files3-'));
    for (const rel of ['a.ts', 'gone/b.ts', 'keep/c.ts']) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'export {};');
    }
    return dir;
  };
  const failingFor = (dir: string, code: string) => {
    const real = fs.readdirSync;
    return vi.spyOn(fs, 'readdirSync').mockImplementation(((p: fs.PathLike, opts?: unknown) => {
      if (path.resolve(String(p)) === path.join(dir, 'gone')) throw Object.assign(new Error(`${code}: gone`), { code });
      return (real as (p: fs.PathLike, o?: unknown) => unknown)(p, opts);
    }) as typeof fs.readdirSync);
  };

  it('skips a directory that vanishes or cannot be read', () => {
    for (const code of ['ENOENT', 'EPERM', 'EACCES', 'ENOTDIR']) {
      const dir = tree();
      const spy = failingFor(dir, code);
      try {
        expect(listSourceFiles(dir)).toEqual(['a.ts', 'keep/c.ts']);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it('rethrows other errors', () => {
    const dir = tree();
    const spy = failingFor(dir, 'EIO');
    try {
      expect(() => listSourceFiles(dir)).toThrow('EIO');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('listSourceFiles on a missing root', () => {
  it('still throws, so a vanished project is not read as an empty one', () => {
    expect(() => listSourceFiles(path.join(os.tmpdir(), 'mapskill-no-such-root-xyz'))).toThrow(/ENOENT/);
  });
});
