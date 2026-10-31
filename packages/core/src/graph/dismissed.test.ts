import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tmpProject } from '../test-helpers';
import { applyFileChanges, findingCodeHash, loadProject, setDismissed } from './project';

const fn = (name: string): string =>
  `export function ${name}(items: number[]) {\n` +
  `  const total = items.reduce((a, b) => a + b, 0);\n` +
  `  const avg = total / Math.max(items.length, 1);\n` +
  `  const big = items.filter((x) => x > avg);\n` +
  `  const small = items.filter((x) => x <= avg);\n` +
  `  console.log(big, small);\n` +
  `  return total;\n` +
  `}\n`;

const project = () =>
  loadProject(tmpProject({ 'package.json': '{}', 'lib/a.ts': fn('sumA'), 'lib/b.ts': fn('sumB') }));

describe('dismissed findings', () => {
  it('hides a dismissed finding until its code changes, and health follows', () => {
    const p = project();
    const dup = p.graph.findings.find((f) => f.kind.endsWith('-duplicate'))!;
    expect(dup).toBeDefined();
    const nodeId = dup.nodeIds[0];
    const healthBefore = p.graph.health[nodeId];

    const result = setDismissed(p, { [dup.id]: findingCodeHash(dup, p.facts) });
    expect(result.reloaded).toBe(false);
    expect(result.empty).toBe(false);
    expect(result.delta.resolvedFindingIds).toContain(dup.id);
    expect(result.project.graph.findings.some((f) => f.id === dup.id)).toBe(false);
    expect(result.project.graph.health[nodeId]).toBeGreaterThan(healthBefore);

    fs.appendFileSync(path.join(p.root, 'lib/b.ts'), '\n// changed\n');
    const changed = applyFileChanges(result.project, ['lib/b.ts']);
    expect(changed.project.graph.findings.some((f) => f.id === dup.id)).toBe(true);
  });

  it('keeps dismissals when the project reloads', () => {
    const p = project();
    const dup = p.graph.findings.find((f) => f.kind.endsWith('-duplicate'))!;
    const dismissed = setDismissed(p, { [dup.id]: findingCodeHash(dup, p.facts) }).project;
    fs.writeFileSync(path.join(p.root, 'package.json'), '{"name":"x"}');
    const reloaded = applyFileChanges(dismissed, ['package.json']);
    expect(reloaded.reloaded).toBe(true);
    expect(reloaded.project.graph.findings.some((f) => f.id === dup.id)).toBe(false);
  });

  it('a stale code hash does not hide anything', () => {
    const p = project();
    const dup = p.graph.findings.find((f) => f.kind.endsWith('-duplicate'))!;
    const result = setDismissed(p, { [dup.id]: 'not-the-hash' });
    expect(result.empty).toBe(true);
    expect(result.project.graph.findings.some((f) => f.id === dup.id)).toBe(true);
  });
});
