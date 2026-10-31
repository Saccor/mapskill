import type { Zone } from '@mapskill/core/client';
import { describe, expect, it } from 'vitest';
import { assignSlots, CARD, layoutMap, MAX_SLOT, ZONE_BOX } from './layout';

const n = (id: string, zone: Zone = 'shared') => ({ id, zone });

describe('assignSlots', () => {
  it('gives new parts the lowest free slots in id order and keeps saved ones', () => {
    expect(assignSlots([n('b'), n('a'), n('c')], {})).toEqual({ a: 0, b: 1, c: 2 });
    expect(assignSlots([n('b'), n('a'), n('c'), n('aa')], { a: 0, b: 1, c: 2 })).toEqual({ a: 0, b: 1, c: 2, aa: 3 });
  });

  it('leaves a gap when a part disappears and fills it with the next new part', () => {
    const after = assignSlots([n('a'), n('c')], { a: 0, b: 1, c: 2 });
    expect(after).toEqual({ a: 0, c: 2 });
    expect(assignSlots([n('a'), n('c'), n('z')], after)).toEqual({ a: 0, c: 2, z: 1 });
  });

  it('numbers each zone on its own and resolves clashes by id', () => {
    expect(assignSlots([n('p', 'pages'), n('h', 'shared')], {})).toEqual({ p: 0, h: 0 });
    expect(assignSlots([n('a'), n('b')], { a: 0, b: 0 })).toEqual({ a: 0, b: 1 });
  });

  it('keeps slots in the target zone when a part changes id and zone', () => {
    const saved = { 'helper:lib/x.ts#X': 0, 'component:a': 0, 'component:b': 1 };
    const after = assignSlots(
      [n('component:lib/x.ts#X', 'blocks'), n('component:a', 'blocks'), n('component:b', 'blocks')],
      saved,
    );
    expect(after['component:a']).toBe(0);
    expect(after['component:b']).toBe(1);
    expect(after['component:lib/x.ts#X']).toBe(2);
  });

  it('treats an absurd saved slot as missing', () => {
    expect(MAX_SLOT).toBe(10_000);
    expect(assignSlots([n('a'), n('b')], { a: 10000, b: 5 })).toEqual({ a: 0, b: 5 });
    expect(assignSlots([n('a')], { a: 9999 })).toEqual({ a: 9999 });
  });
});

describe('layoutMap', () => {
  it('places parts by slot inside their zone box', () => {
    const nodes = [n('a'), n('b'), n('c'), n('d')];
    const { zones, positions } = layoutMap(nodes, { a: 0, b: 1, c: 2, d: 3 }, new Set());
    expect(positions.a).toEqual({ x: ZONE_BOX.padding, y: ZONE_BOX.header });
    expect(positions.d).toEqual({ x: ZONE_BOX.padding, y: ZONE_BOX.header + CARD.height + CARD.gapY });
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ zone: 'shared', count: 4, collapsed: false });
  });

  it('does not move existing parts when a part is added to the same zone', () => {
    const before = layoutMap([n('a'), n('b')], assignSlots([n('a'), n('b')], {}), new Set());
    const slots = assignSlots([n('a'), n('b'), n('c')], { a: 0, b: 1 });
    const after = layoutMap([n('a'), n('b'), n('c')], slots, new Set());
    expect(after.positions.a).toEqual(before.positions.a);
    expect(after.positions.b).toEqual(before.positions.b);
  });

  it('is identical when nothing was added or removed', () => {
    const nodes = [n('p', 'pages'), n('s', 'server'), n('h')];
    const slots = assignSlots(nodes, {});
    expect(layoutMap(nodes, slots, new Set())).toEqual(layoutMap([...nodes].reverse(), slots, new Set()));
  });

  it('stacks zones in two columns and collapses tests', () => {
    const nodes = [n('p', 'pages'), n('h', 'shared'), n('s', 'server'), n('t', 'tests')];
    const { zones, positions } = layoutMap(nodes, assignSlots(nodes, {}), new Set<Zone>(['tests']));
    const pages = zones.find((z) => z.zone === 'pages')!;
    const shared = zones.find((z) => z.zone === 'shared')!;
    const server = zones.find((z) => z.zone === 'server')!;
    const tests = zones.find((z) => z.zone === 'tests')!;
    expect(pages.x).toBe(0);
    expect(shared.y).toBe(pages.y + pages.height + ZONE_BOX.gap);
    expect(server.x).toBe(Math.max(pages.width, shared.width) + ZONE_BOX.columnGap);
    expect(tests.collapsed).toBe(true);
    expect(tests.height).toBe(ZONE_BOX.header + ZONE_BOX.padding);
    expect(positions.t).toBeUndefined();
    expect(zones.some((z) => z.zone === 'data')).toBe(false);
  });
});
