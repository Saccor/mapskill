import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tmpProject } from '../test-helpers';
import { applyFileChanges, findDrift, isProjectConfigFile, loadProject } from './project';
import { scanProject } from './scan';

const PKG = JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } });
const TSCONFIG = JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['./*'] } } });
const fn = (name: string): string =>
  `export function ${name}(items: number[]) {\n` +
  `  const total = items.reduce((a, b) => a + b, 0);\n` +
  `  const avg = total / Math.max(items.length, 1);\n` +
  `  const big = items.filter((x) => x > avg);\n` +
  `  const small = items.filter((x) => x <= avg);\n` +
  `  console.log(big, small);\n` +
  `  return total;\n` +
  `}\n`;
const write = (root: string, rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const base = (): string =>
  tmpProject({
    'package.json': PKG,
    'tsconfig.json': TSCONFIG,
    'app/page.tsx': "import { sumA } from '@/lib/a';\nexport default function Page() {\n  return <p>{sumA([1])}</p>;\n}\n",
    'lib/a.ts': fn('sumA'),
  });

describe('applyFileChanges', () => {
  it('finds a duplicate added in a new file and matches a full scan', () => {
    const root = base();
    const project = loadProject(root);
    write(root, 'lib/b.ts', fn('sumB'));
    const r = applyFileChanges(project, ['lib/b.ts']);
    expect(r.reloaded).toBe(false);
    expect(r.empty).toBe(false);
    expect(r.delta.addedFindings.some((f) => f.kind.endsWith('-duplicate') && f.files.includes('lib/b.ts'))).toBe(true);
    expect(r.project.graph).toEqual(scanProject(root));
  });

  it('removes the nodes of a deleted file', () => {
    const root = base();
    write(root, 'lib/b.ts', fn('sumB'));
    const project = loadProject(root);
    fs.rmSync(path.join(root, 'lib/b.ts'));
    const r = applyFileChanges(project, ['lib\\b.ts']);
    expect(r.delta.removedNodeIds.some((id) => id.includes('lib/b.ts'))).toBe(true);
    expect(r.project.facts['lib/b.ts']).toBeUndefined();
    expect(r.project.graph).toEqual(scanProject(root));
  });

  it('resolves an import once the imported file appears', () => {
    const root = base();
    write(root, 'lib/c.ts', "import { d } from './d';\nexport const c = d;\n");
    const project = loadProject(root);
    expect(project.graph.links.some((l) => l.from === 'lib/c.ts')).toBe(false);
    write(root, 'lib/d.ts', 'export const d = 1;\n');
    const r = applyFileChanges(project, ['lib/d.ts']);
    expect(r.project.graph.links.some((l) => l.from === 'lib/c.ts' && l.to === 'lib/d.ts')).toBe(true);
    expect(r.project.graph).toEqual(scanProject(root));
  });

  it('ignores files that are not source files', () => {
    const root = base();
    const project = loadProject(root);
    write(root, 'README.md', '# hi\n');
    write(root, 'node_modules/x/index.ts', 'export const x = 1;\n');
    const r = applyFileChanges(project, ['README.md', 'node_modules/x/index.ts']);
    expect(r.empty).toBe(true);
    expect(r.project).toBe(project);
  });

  it('reloads the whole project when a config file changes', () => {
    const root = base();
    const project = loadProject(root);
    write(root, 'package.json', JSON.stringify({ dependencies: { react: '19.0.0' } }));
    const r = applyFileChanges(project, ['package.json']);
    expect(r.reloaded).toBe(true);
    expect(r.delta.framework).toBe('generic');
    expect(r.project.graph).toEqual(scanProject(root));
  });

  it('keeps the last readable version of a file that no longer parses', () => {
    const root = base();
    const project = loadProject(root);
    const good = project.facts['lib/a.ts'];
    write(root, 'lib/a.ts', 'export function sumA(items: number[] {\n');
    const broken = applyFileChanges(project, ['lib/a.ts']);
    const kept = broken.project.facts['lib/a.ts'];
    expect(kept.stale).toBe(true);
    expect(kept.parseError).toBeTruthy();
    expect(kept.functions).toEqual(good.functions);
    expect(broken.delta.unreadableFiles).toEqual(['lib/a.ts']);
    expect(broken.empty).toBe(false);

    write(root, 'lib/a.ts', fn('sumA'));
    const fixed = applyFileChanges(broken.project, ['lib/a.ts']);
    expect(fixed.project.facts['lib/a.ts'].stale).toBeUndefined();
    expect(fixed.project.facts['lib/a.ts'].parseError).toBeUndefined();
    expect(fixed.delta.unreadableFiles).toEqual([]);
  });
});

describe('isProjectConfigFile', () => {
  it('recognises files that change how the whole project is read', () => {
    const yes = [
      'package.json', 'tsconfig.json', 'jsconfig.json', 'tsconfig.base.json', 'prisma/schema.prisma',
      'components.json', '.gitignore', 'packages/web/package.json',
    ];
    for (const rel of yes) expect(isProjectConfigFile(rel), rel).toBe(true);
    for (const rel of ['lib/a.ts', 'app/tsconfig.ts', 'README.md', 'src/tsconfig.json']) expect(isProjectConfigFile(rel), rel).toBe(false);
  });
});

describe('findDrift', () => {
  it('lists files that changed on disk without an event', () => {
    const root = base();
    write(root, 'lib/old.ts', 'export const old = 1;\n');
    const project = loadProject(root);
    fs.writeFileSync(path.join(root, 'lib/a.ts'), `${fn('sumA')}// edited\n`);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(root, 'lib/a.ts'), later, later);
    write(root, 'lib/new.ts', 'export const n = 1;\n');
    fs.rmSync(path.join(root, 'lib/old.ts'));
    expect(findDrift(project)).toEqual(['lib/a.ts', 'lib/new.ts', 'lib/old.ts']);
  });
});
