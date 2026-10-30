import { describe, expect, it } from 'vitest';
import { scanProject } from '../graph/scan';
import { fixture } from '../test-helpers';

describe('findDuplicates', () => {
  const messy = scanProject(fixture('messy-app'));
  const of = (kind: string) => messy.findings.filter((f) => f.kind === kind);

  it('finds exact duplicates', () => {
    const [f] = of('exact-duplicate');
    expect(f.certainty).toBe('certain');
    expect(f.nodeIds).toEqual(expect.arrayContaining(['helper:lib/date.ts#formatDate', 'helper:lib/date.ts#formatDateCopy']));
    expect(f.message.sv).toContain('formatDate');
  });

  it('finds renamed duplicates across files', () => {
    const [f] = of('renamed-duplicate');
    expect(f.certainty).toBe('certain');
    expect(f.nodeIds).toContain('helper:lib/date-utils.ts#formatDay');
    expect(f.files).toEqual(['lib/date-utils.ts', 'lib/date.ts']);
  });

  it('finds near duplicates as likely', () => {
    const [f] = of('near-duplicate');
    expect(f.certainty).toBe('likely');
    expect([...f.nodeIds].sort()).toEqual(['helper:lib/cart.ts#cartTotal', 'helper:lib/cart.ts#orderTotal']);
  });

  it('reports nothing in clean-app', () => {
    const clean = scanProject(fixture('clean-app'));
    expect(clean.findings.filter((f) => f.kind.endsWith('duplicate'))).toEqual([]);
  });
});
