import { describe, expect, it } from 'vitest';
import { assignSlots } from './layout';
import type { GoalStatus } from '@mapskill/core/client';
import { computeSlots, inheritGhostSlots, layoutPhase, mergeForSave, restorableSlots, shouldSave, SlotSession, withTimeout } from './slots';

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

describe('inheritGhostSlots', () => {
  const goal = (done: boolean, zone: 'pages' | 'blocks' = 'pages'): GoalStatus => ({
    goalId: 'g', title: { en: 'G', sv: 'G' }, done: done ? 1 : 0, total: 1,
    items: [{ id: 'pricing-page', title: { en: 'P', sv: 'P' }, why: { en: '', sv: '' }, done, zone, nodeType: 'page', matchedNodeIds: done ? ['page:app/pricing/page.tsx'] : [] }],
  });
  const page = { id: 'page:app/pricing/page.tsx', zone: 'pages' as const };
  it('gives the real part the slot of its ghost', () => {
    expect(inheritGhostSlots([page], { 'ghost:pricing-page': 5 }, goal(true))).toEqual({ [page.id]: 5 });
    const slots = computeSlots([page, { id: 'page:app/a.tsx', zone: 'pages' }], {}, {}, { 'ghost:pricing-page': 5, 'page:app/a.tsx': 0 }, goal(true));
    expect(slots[page.id]).toBe(5);
  });
  it('does nothing when another part holds the slot, the zone differs, or the item is not done', () => {
    expect(inheritGhostSlots([page, { id: 'page:other', zone: 'pages' }], { 'ghost:pricing-page': 5, 'page:other': 5 }, goal(true))).toEqual({});
    expect(inheritGhostSlots([page], { 'ghost:pricing-page': 5 }, goal(true, 'blocks'))).toEqual({});
    expect(inheritGhostSlots([page], { 'ghost:pricing-page': 5 }, goal(false))).toEqual({});
    expect(inheritGhostSlots([page], { 'ghost:pricing-page': 5, [page.id]: 2 }, goal(true))).toEqual({});
    expect(inheritGhostSlots([page], { 'ghost:pricing-page': 5 }, null)).toEqual({});
  });
});

describe('inheritGhostSlots in multi-step builds', () => {
  const item = (over: Partial<GoalStatus['items'][number]>): GoalStatus['items'][number] =>
    ({ id: 'checkout', title: { en: 'C', sv: 'C' }, why: { en: '', sv: '' }, done: true, zone: 'server', nodeType: 'api-route', matchedNodeIds: [], ...over });
  const goalOf = (i: GoalStatus['items'][number]): GoalStatus => ({ goalId: 'g', title: { en: 'G', sv: 'G' }, done: 1, total: 1, items: [i] });
  const ghost = { id: 'ghost:checkout', zone: 'server' as const };
  const route = { id: 'api-route:app/api/checkout/route.ts', zone: 'server' as const };
  const other = { id: 'api-route:app/api/other/route.ts', zone: 'server' as const };

  it('moves a fresh part from its fresh slot to the ghost slot and releases the old one', () => {
    const session = new SlotSession();
    session.loaded({}, false);
    const pending = goalOf(item({ done: false, matchedNodeIds: [] }));
    const s1 = session.compute([other, ghost], pending);
    expect(Object.keys(s1).sort()).toEqual([ghost.id, other.id].sort());
    // The route arrives while the ghost is still shown: it gets a fresh slot and nothing else moves.
    const s2 = session.compute([other, ghost, route], pending);
    expect(s2[ghost.id]).toBe(s1[ghost.id]);
    expect(s2[other.id]).toBe(s1[other.id]);
    expect(s2[route.id]).not.toBe(s1[ghost.id]);
    const rows = (s: Record<string, number>, ids: string[]) => Math.max(...ids.map((id) => s[id])) + 1;
    // The item turns done: the ghost is gone and the route takes its place.
    const done = goalOf(item({ matchedNodeIds: [route.id] }));
    const s3 = session.compute([other, route], done);
    expect(s3[route.id]).toBe(s1[ghost.id]);
    expect(s3[other.id]).toBe(s1[other.id]);
    expect(rows(s3, [other.id, route.id])).toBe(rows(s1, [other.id, ghost.id]));
    // And it stays there.
    expect(session.compute([other, route], done)[route.id]).toBe(s1[ghost.id]);
  });

  it('never moves a part that was in the layout loaded at session start', () => {
    const session = new SlotSession();
    session.loaded({ [route.id]: 3 }, false);
    const s1 = session.compute([ghost, route], goalOf(item({ done: false })));
    const s2 = session.compute([route], goalOf(item({ matchedNodeIds: [route.id] })));
    expect(s2[route.id]).toBe(s1[route.id]);
    expect(s2[route.id]).toBe(3);
  });

  it('makes the table the heir of a table item', () => {
    const table = { id: 'table:subscriptions', zone: 'data' as const };
    const page = { id: 'page:app/x/page.tsx', zone: 'pages' as const };
    const g = goalOf(item({ id: 'subscriptions-table', zone: 'data', nodeType: 'table', matchedNodeIds: [table.id, page.id] }));
    expect(inheritGhostSlots([table, page], { 'ghost:subscriptions-table': 4 }, g)).toEqual({ [table.id]: 4 });
  });

  it('lets the first matched part without a held slot inherit', () => {
    const a = { id: 'api-route:a', zone: 'server' as const };
    const b = { id: 'api-route:b', zone: 'server' as const };
    const g = goalOf(item({ matchedNodeIds: [a.id, b.id] }));
    expect(inheritGhostSlots([a, b], { 'ghost:checkout': 4, [a.id]: 1 }, g)).toEqual({ [b.id]: 4 });
    expect(inheritGhostSlots([a, b], { 'ghost:checkout': 4 }, g)).toEqual({ [a.id]: 4 });
  });
});
