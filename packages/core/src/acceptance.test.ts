import { describe, expect, it } from 'vitest';
import { scanProject } from './graph/scan';
import { fixture } from './test-helpers';

describe('M1 acceptance criteria from the spec', () => {
  it('finds every planted problem in messy-app', () => {
    const g = scanProject(fixture('messy-app'));
    const has = (kind: string, file: string) => g.findings.some((f) => f.kind === kind && f.files.includes(file));
    expect(has('exact-duplicate', 'lib/date.ts')).toBe(true);
    expect(has('renamed-duplicate', 'lib/date-utils.ts')).toBe(true);
    expect(has('near-duplicate', 'lib/cart.ts')).toBe(true);
    expect(has('unused-export', 'lib/date.ts')).toBe(true);
    expect(has('orphan-file', 'components/OldBanner.tsx')).toBe(true);
    expect(has('client-touches-server', 'app/page.tsx')).toBe(true);
    expect(has('page-touches-table', 'app/page.tsx')).toBe(true);
    expect(has('circular-import', 'lib/cycle-a.ts')).toBe(true);
    expect(has('hardcoded-secret', 'app/api/checkout/route.ts')).toBe(true);
    expect(g.findings.some((f) => f.kind === 'hardcoded-secret' && f.certainty === 'certain' && f.files.includes('app/api/test/route.ts'))).toBe(true);
    expect(has('swallowed-error', 'lib/notify.ts')).toBe(true);
    expect(has('complex-function', 'lib/discount.ts')).toBe(true);
  });

  it.each(['clean-app', 'conventions-app', 'beginner-app'])('reports no certain findings in %s', (name) => {
    const g = scanProject(fixture(name));
    expect(g.findings.filter((f) => f.certainty === 'certain')).toEqual([]);
  });

  it('gives every finding a unique id', () => {
    const g = scanProject(fixture('messy-app'));
    const ids = g.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
