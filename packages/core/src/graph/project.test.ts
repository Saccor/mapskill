import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createResolver } from '../resolve/resolver';
import { createSourceFilter, listSourceFiles } from '../scan/files';
import { fixture, tmpProject } from '../test-helpers';
import { buildGraph, loadProject, readSourceFile } from './project';
import { scanProject } from './scan';

describe('loadProject', () => {
  it('gives the same graph as scanProject', () => {
    expect(loadProject(fixture('messy-app')).graph).toEqual(scanProject(fixture('messy-app')));
  });

  it('builds the same graph whatever order the facts were stored in', () => {
    const p = loadProject(fixture('beginner-app'));
    const reversed = Object.fromEntries(Object.entries(p.facts).reverse());
    expect(buildGraph({ ...p, facts: reversed })).toEqual(p.graph);
  });

  it('reuses cached facts when the content hash matches', () => {
    const first = loadProject(fixture('clean-app'));
    const second = loadProject(fixture('clean-app'), first.facts);
    for (const rel of Object.keys(first.facts)) expect(second.facts[rel].functions).toBe(first.facts[rel].functions);
  });

  it('ignores cached facts whose hash does not match', () => {
    const root = tmpProject({ 'lib/a.ts': 'export const a = 1;\n' });
    const first = loadProject(root);
    fs.writeFileSync(path.join(root, 'lib/a.ts'), 'export const b = 2;\n');
    const second = loadProject(root, first.facts);
    expect(second.facts['lib/a.ts'].exports.map((e) => e.name)).toEqual(['b']);
  });
});

describe('readSourceFile', () => {
  it('reports missing and oversized files', () => {
    const root = tmpProject({ 'big.ts': `export const x = '${'a'.repeat(1_000_001)}';\n` });
    expect(readSourceFile(root, 'nope.ts')).toBe('missing');
    expect(readSourceFile(root, 'big.ts')).toBe('skipped');
  });
});

describe('createSourceFilter', () => {
  it('accepts every file listSourceFiles returns in the fixtures', () => {
    for (const name of ['clean-app', 'messy-app', 'conventions-app', 'beginner-app']) {
      const root = fixture(name);
      const isSource = createSourceFilter(root);
      for (const rel of listSourceFiles(root)) expect(isSource(rel), rel).toBe(true);
    }
  });

  it('rejects skipped folders, ignored files and non-code files', () => {
    const root = tmpProject({ '.gitignore': 'generated/\nsecret.ts\n', 'lib/a.ts': '' });
    const isSource = createSourceFilter(root);
    const rejected = [
      'node_modules/x/index.ts', 'lib/node_modules/y.ts', 'dist/a.ts', 'public/sw.js', '.mapskill/x.ts',
      'generated/a.ts', 'secret.ts', 'README.md', 'types.d.ts', '../outside.ts', '',
    ];
    for (const rel of rejected) expect(isSource(rel), rel).toBe(false);
    for (const rel of ['lib/a.ts', 'lib/dist/a.ts', 'src/new-file.tsx']) expect(isSource(rel), rel).toBe(true);
  });
});

describe('resolver.clearCache', () => {
  it('lets a newly created file be resolved', () => {
    const root = tmpProject({ 'a.ts': "import { b } from './b';\n" });
    const resolver = createResolver(root);
    resolver.resolve('./b', 'a.ts');
    fs.writeFileSync(path.join(root, 'b.ts'), 'export const b = 1;\n');
    resolver.clearCache();
    expect(resolver.resolve('./b', 'a.ts')).toBe('b.ts');
  });
});
