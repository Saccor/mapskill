import { describe, expect, it } from 'vitest';
import { mergeForSave } from './slots';

describe('mergeForSave', () => {
  it('keeps slots of parts that are gone and lets current ones win', () => {
    expect(mergeForSave({ a: 0, gone: 1 }, { a: 2, b: 3 })).toEqual({ a: 2, gone: 1, b: 3 });
  });
  it('drops ids outside the graph first when over the cap', () => {
    const known = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`old${i}`, i]));
    const out = mergeForSave(known, { a: 0, b: 1 });
    expect(Object.keys(out)).toHaveLength(20_000);
    expect(out.a).toBe(0);
    expect(out.b).toBe(1);
  });
});
