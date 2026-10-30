import { describe, expect, it } from 'vitest';
import { makeFinding } from './context';

describe('makeFinding', () => {
  it('is independent of nodeIds order', () => {
    const msg = { en: 'a', sv: 'b' };
    const a = makeFinding('duplicate' as never, 'sure' as never, ['x.ts'], ['n2', 'n1', undefined], msg, 'i');
    const b = makeFinding('duplicate' as never, 'sure' as never, ['x.ts'], ['n1', 'n2'], msg, 'i');
    expect(a.id).toBe(b.id);
    expect(a.nodeIds).toEqual(b.nodeIds);
    expect(a.nodeIds).toEqual(['n1', 'n2']);
  });
});
