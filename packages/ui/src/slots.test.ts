import { describe, expect, it } from 'vitest';
import { assignSlots } from './layout';
import { computeSlots, mergeForSave, restorableSlots } from './slots';

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

describe('restorableSlots', () => {
  const node = (id: string) => ({ id, zone: 'blocks' as const });
  it('lets a returning part keep nothing when its slot was taken meanwhile', () => {
    // X(3) gone, Y took slot 3; X returns
    const out = restorableSlots({ y: 3 }, { x: 3, y: 3 }, [node('x'), node('y')]);
    expect(out).toEqual({ y: 3 });
    expect(assignSlots([node('x'), node('y')], out).y).toBe(3);
  });
  it('gives the old slot back when nobody took it', () => {
    expect(restorableSlots({ a: 0 }, { x: 3, a: 0 }, [node('x'), node('a')])).toEqual({ x: 3, a: 0 });
  });
  it('only compares within the same zone', () => {
    const nodes = [{ id: 'x', zone: 'blocks' as const }, { id: 'y', zone: 'server' as const }];
    expect(restorableSlots({ y: 3 }, { x: 3, y: 3 }, nodes).x).toBe(3);
  });
});

describe('computeSlots', () => {
  const node = (id: string) => ({ id, zone: 'blocks' as const });
  it('keeps a fresh slot when a part with a lower id arrives before any save', () => {
    const first = computeSlots([node('y')], {}, {}, {});
    expect(first).toEqual({ y: 0 });
    const second = computeSlots([node('w'), node('y')], {}, {}, first);
    expect(second.y).toBe(0);
    expect(second.w).toBe(1);
  });
  it('uses the saved slot of a part, with no provisional id-order slots', () => {
    expect(computeSlots([node('w'), node('y')], { y: 5 }, {}, {})).toEqual({ y: 5, w: 0 });
  });
});
