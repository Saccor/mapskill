import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSourceFiles } from '../scan/files';
import { fixture } from '../test-helpers';
import { applyDelta, toPublicGraph, type PublicGraph } from './delta';
import { applyFileChanges, loadProject } from './project';
import { scanProject } from './scan';

/** Small seeded PRNG so every failure can be replayed. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(xs: T[], rnd: () => number): T => xs[Math.floor(rnd() * xs.length)];
const abs = (root: string, rel: string): string => path.join(root, rel);
const withoutExt = (rel: string): string => rel.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
const helper = (name: string): string =>
  `export function ${name}(items: number[]) {\n` +
  `  const total = items.reduce((a, b) => a + b, 0);\n` +
  `  const avg = total / Math.max(items.length, 1);\n` +
  `  const big = items.filter((x) => x > avg);\n` +
  `  const small = items.filter((x) => x <= avg);\n` +
  `  const label = big.length > small.length ? 'big' : 'small';\n` +
  `  console.log(label);\n` +
  `  return { total, avg, label };\n` +
  `}\n`;
const writeFile = (root: string, rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(abs(root, rel)), { recursive: true });
  fs.writeFileSync(abs(root, rel), text);
};

/** Each operation changes the project on disk and returns the paths a watcher would report. */
type Op = (root: string, rnd: () => number, step: number) => string[];

const ops: Record<string, Op> = {
  appendFunction: (root, rnd, step) => {
    const f = pick(listSourceFiles(root), rnd);
    fs.appendFileSync(abs(root, f), `\n${helper(`gen${step}`)}`);
    return [f];
  },
  addCopy: (root, _rnd, step) => {
    const rel = `lib/copy${step}.ts`;
    writeFile(root, rel, helper(`copy${step}`));
    return [rel];
  },
  addImporter: (root, rnd, step) => {
    const candidates = listSourceFiles(root).flatMap((f) =>
      [...fs.readFileSync(abs(root, f), 'utf8').matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map((m) => ({ f, name: m[1] })),
    );
    if (candidates.length === 0) return [];
    const { f, name } = pick(candidates, rnd);
    let spec = path.posix.relative('lib', withoutExt(f));
    if (!spec.startsWith('.')) spec = `./${spec}`;
    const rel = `lib/use${step}.ts`;
    writeFile(root, rel, `import { ${name} } from '${spec}';\nexport const use${step} = ${name};\n`);
    return [rel];
  },
  removeImportLine: (root, rnd) => {
    const f = pick(listSourceFiles(root), rnd);
    const lines = fs.readFileSync(abs(root, f), 'utf8').split('\n');
    const candidates = lines.flatMap((l, i) => (/^import .* from ['"][^'"]+['"];?\s*$/.test(l) ? [i] : []));
    if (candidates.length === 0) return [];
    lines.splice(pick(candidates, rnd), 1);
    fs.writeFileSync(abs(root, f), lines.join('\n'));
    return [f];
  },
  deleteFile: (root, rnd) => {
    const files = listSourceFiles(root);
    if (files.length <= 3) return [];
    const f = pick(files, rnd);
    fs.rmSync(abs(root, f));
    return [f];
  },
  renameFile: (root, rnd, step) => {
    const f = pick(listSourceFiles(root), rnd);
    const to = f.replace(/(\.\w+)$/, `_r${step}$1`);
    fs.renameSync(abs(root, f), abs(root, to));
    return [f, to];
  },
  touch: (root, rnd, step) => {
    const f = pick(listSourceFiles(root), rnd);
    const t = new Date(Date.now() + step * 1000);
    fs.utimesSync(abs(root, f), t, t);
    return [f];
  },
  skippedFolder: (root, _rnd, step) => {
    const rel = `node_modules/pkg${step}/index.ts`;
    writeFile(root, rel, helper(`hidden${step}`));
    return [rel];
  },
};

function copyFixture(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mapskill-prop-${name}-`));
  fs.cpSync(fixture(name), dir, { recursive: true });
  return dir;
}

const byId = <T extends { id: string }>(xs: T[]): T[] => [...xs].sort((a, b) => a.id.localeCompare(b.id));
const sorted = (g: PublicGraph): PublicGraph => ({ ...g, nodes: byId(g.nodes), edges: byId(g.edges), findings: byId(g.findings) });

describe.each([
  ['messy-app', 1],
  ['beginner-app', 2],
  ['conventions-app', 3],
  ['clean-app', 4],
])('incremental updates on %s', (name, seed) => {
  it('match a full scan after every random change', () => {
    const root = copyFixture(name);
    const rnd = mulberry32(seed);
    const names = Object.keys(ops);
    let project = loadProject(root);
    for (let step = 1; step <= 25; step++) {
      const opName = pick(names, rnd);
      const before = toPublicGraph(project.graph);
      const changed = ops[opName](root, rnd, step);
      const result = applyFileChanges(project, changed);
      project = result.project;
      const full = scanProject(root);
      expect(project.graph, `seed ${seed}, step ${step}: ${opName} ${changed.join(', ')}`).toEqual(full);
      expect(sorted(applyDelta(before, result.delta))).toEqual(sorted(toPublicGraph(full)));
    }
  }, 60_000);
});
