import { describe, expect, it } from 'vitest';
import { scanProject } from '../graph/scan';
import { fixture, tmpProject } from '../test-helpers';
import { findCycles } from './cycles';

describe('findCycles', () => {
  it('returns strongly connected groups, ignoring type-only links', () => {
    expect(
      findCycles([
        { from: 'a', to: 'b', names: [], typeOnly: false },
        { from: 'b', to: 'a', names: [], typeOnly: false },
        { from: 'b', to: 'c', names: [], typeOnly: false },
        { from: 'c', to: 'd', names: [], typeOnly: true },
        { from: 'd', to: 'c', names: [], typeOnly: false },
      ]),
    ).toEqual([['a', 'b']]);
  });
});

describe('findRuleBreaks on messy-app', () => {
  const g = scanProject(fixture('messy-app'));
  const find = (kind: string) => g.findings.filter((f) => f.kind === kind);

  it('flags browser code that touches server secrets', () => {
    const [f] = find('client-touches-server');
    expect(f.certainty).toBe('certain');
    expect(f.files).toEqual(['app/page.tsx']);
    expect(f.message.en).toContain('STRIPE_SECRET_KEY');
  });

  it('flags direct table access from the browser as likely', () => {
    const [f] = find('page-touches-table');
    expect(f.certainty).toBe('likely');
    expect(f.message.en).toContain('orders');
  });

  it('flags the import cycle, the secret, the swallowed error and the complex function', () => {
    expect(find('circular-import')[0].files).toEqual(['lib/cycle-a.ts', 'lib/cycle-b.ts']);
    expect(find('hardcoded-secret')[0]).toMatchObject({ certainty: 'certain', files: ['app/api/checkout/route.ts'] });
    expect(find('swallowed-error')[0]).toMatchObject({ certainty: 'likely', nodeIds: ['helper:lib/notify.ts#notify'] });
    expect(find('complex-function')[0]).toMatchObject({ certainty: 'likely', nodeIds: ['helper:lib/discount.ts#discountFor'] });
  });

  it('lowers health for nodes with findings', () => {
    expect(g.health['helper:lib/date-utils.ts#formatDay']).toBeLessThan(10);
    expect(g.health['helper:lib/discount.ts#discountFor']).toBe(9);
  });
});

describe('cycles with inline type imports', () => {
  it('does not report a cycle made only of inline type imports', () => {
    const root = tmpProject({
      'package.json': '{"dependencies":{"next":"16"}}',
      'app/page.tsx': `import { makeA } from '../lib/a'; import { makeB } from '../lib/b'; export default function P() { return <p>{String(makeA() && makeB())}</p>; }`,
      'lib/a.ts': `import { type B } from './b'; export type A = { b?: B }; export const makeA = (): A => ({});`,
      'lib/b.ts': `import { type A } from './a'; export type B = { a?: A }; export const makeB = (): B => ({});`,
    });
    expect(scanProject(root).findings.filter((f) => f.kind === 'circular-import')).toEqual([]);
  });
});
