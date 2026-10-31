import { describe, expect, it } from 'vitest';
import { assignSlots } from './layout';
import { computeSlots, layoutPhase, mergeForSave, restorableSlots, shouldSave, SlotSession, withTimeout } from './slots';

describe('mergeForSave', () => {
  it('keeps slots of parts that are gone and lets current ones win', () => {
    expect(mergeForSave({ a: 0, gone: 1 }, { a: 2, b: 3 })).toEqual({ a: 2, gone: 1, b: 3 });
  });
  it('drops ids outside the graph first when over the cap', () => {
    const known = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`old${i}`, i]));
    const out = mergeForSave(known, { a: 0, b: 1 });
    expect(Object.keys(out)).toHaveLength(10_000);
    expect(out.a).toBe(0);
    expect(out.b).toBe(1);
  });
});

describe('SlotSession after a degraded start', () => {
  const nodes = (...ids: string[]) => ids.map((id) => ({ id, zone: 'blocks' as const }));
  it('switches to the saved layout on a late load and never writes provisional slots over it', () => {
    const file = { b: 0, a: 1 };
    const session = new SlotSession();
    // Three failed loads: the map shows with no remembered layout, and nothing may be saved.
    const provisional = session.compute(nodes('a', 'b'));
    expect(provisional).toEqual({ a: 0, b: 1 });
    // The load finally succeeds.
    session.loaded(file, true);
    const afterLoad = session.compute(nodes('a', 'b'));
    expect(afterLoad).toEqual({ b: 0, a: 1 });
    let disk: Record<string, number> = { ...file };
    // First save: nothing new, nothing to write.
    expect(session.pendingSave(afterLoad)).toBeNull();
    // A graph change adds a part: the save keeps the file's slots.
    const next = session.compute(nodes('a', 'b', 'c'));
    const save = session.pendingSave(next)!;
    disk = save;
    session.saved(save);
    expect(disk.a).toBe(1);
    expect(disk.b).toBe(0);
    // And another change after that.
    const again = session.compute(nodes('a', 'b', 'c', 'd'));
    disk = session.pendingSave(again)!;
    expect(disk).toMatchObject({ a: 1, b: 0 });
    expect(new Set(Object.values(again)).size).toBe(4);
  });
});

describe('layout load state', () => {
  it('waits, then renders without a layout after three failures, and is loaded after a success', () => {
    expect(layoutPhase({ loaded: false, failures: 0 })).toBe('loading');
    expect(layoutPhase({ loaded: false, failures: 2 })).toBe('loading');
    expect(layoutPhase({ loaded: false, failures: 3 })).toBe('degraded');
    expect(layoutPhase({ loaded: true, failures: 3 })).toBe('loaded');
  });
  it('saves only after a successful load and only when something changed', () => {
    expect(shouldSave({ loaded: false, failures: 3, dirty: true })).toBe(false);
    expect(shouldSave({ loaded: false, failures: 0, dirty: true })).toBe(false);
    expect(shouldSave({ loaded: true, failures: 0, dirty: false })).toBe(false);
    expect(shouldSave({ loaded: true, failures: 1, dirty: true })).toBe(true);
  });
  it('gives up on a load that takes too long', async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 10)).rejects.toThrow('timeout');
    await expect(withTimeout(Promise.resolve(7), 10)).resolves.toBe(7);
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
