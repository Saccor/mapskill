import type { PublicGraph, ServerMessage } from '@mapskill/core/client';
import { describe, expect, it } from 'vitest';
import { initialState, PULSE_MS, reduce } from './reducer';

const graph = (ids: string[]): PublicGraph => ({
  root: '/p', framework: 'nextjs', findings: [], health: {}, fileCount: ids.length, unreadableFiles: [], edges: [],
  nodes: ids.map((id) => ({ id, type: 'helper', zone: 'shared', label: id, file: `lib/${id}.ts` })),
});
const emptyDelta = {
  addedNodes: [], removedNodeIds: [], changedNodes: [], addedEdges: [], removedEdgeIds: [],
  addedFindings: [], resolvedFindingIds: [], changedFindings: [], framework: 'nextjs' as const, health: {}, fileCount: 1, unreadableFiles: [],
};

describe('reduce', () => {
  it('applies deltas in order and asks for a resync on a gap', () => {
    let s = reduce(initialState, { type: 'server', message: { type: 'graph', seq: 3, graph: graph(['a']) }, now: 0 });
    expect(s.seq).toBe(3);
    s = reduce(s, {
      type: 'server', now: 0,
      message: { type: 'delta', seq: 4, delta: { ...emptyDelta, addedNodes: [{ id: 'b', type: 'helper', zone: 'shared', label: 'b' }] } },
    });
    expect(s.graph!.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    const gap = reduce(s, { type: 'server', now: 0, message: { type: 'delta', seq: 9, delta: emptyDelta } });
    expect(gap.needsResync).toBe(true);
    expect(gap.graph).toBe(s.graph);
    const fresh = reduce(gap, { type: 'server', now: 0, message: { type: 'graph', seq: 9, graph: graph(['a']) } });
    expect(fresh.needsResync).toBe(false);
  });

  it('tracks pulses and the files touched in this turn', () => {
    let s = reduce(initialState, { type: 'server', now: 0, message: { type: 'activity', at: 1000, files: [{ path: 'lib/a.ts', by: 'claude' }] } });
    expect(s.pulseUntil['lib/a.ts']).toBe(1000 + PULSE_MS);
    expect(s.touchedThisTurn).toEqual(['lib/a.ts']);
    expect(s.activity).toHaveLength(1);
    s = reduce(s, { type: 'server', now: 0, message: { type: 'turn', at: 2000, sessionId: 's' } });
    expect(s.touchedThisTurn).toEqual([]);
    expect(s.turnStartedAt).toBe(2000);
  });

  it('keeps at most 50 activity entries and replaces requests and locks', () => {
    let s = initialState;
    for (let i = 0; i < 60; i++) s = reduce(s, { type: 'server', now: 0, message: { type: 'activity', at: i, files: [] } });
    expect(s.activity).toHaveLength(50);
    expect(s.activity[0].at).toBe(59);
    s = reduce(s, { type: 'locks', locks: [{ path: 'lib/a.ts', lockedAt: 1 }], lockedFiles: ['lib/a.ts'] });
    expect(s.lockedFiles).toEqual(['lib/a.ts']);
    s = reduce(s, { type: 'server', now: 0, message: { type: 'requests', requests: [] } });
    expect(s.requests).toEqual([]);
  });

  it('applies a delta and the goal it carries in one step', () => {
    const live = { goalId: 'g', title: { en: 'G', sv: 'G' }, items: [], done: 1, total: 2 };
    const s0 = reduce(initialState, { type: 'server', now: 0, message: { type: 'graph', seq: 3, graph: graph(['a']) } });
    const s1 = reduce(s0, { type: 'server', now: 0, message: { type: 'delta', seq: 4, delta: { ...emptyDelta, addedNodes: [{ id: 'b', type: 'helper', zone: 'shared', label: 'b' }] }, goal: live } });
    expect(s1.graph!.nodes.map((n) => n.id)).toContain('b');
    expect(s1.goal).toEqual(live);
    const s2 = reduce(s1, { type: 'server', now: 0, message: { type: 'delta', seq: 5, delta: emptyDelta } });
    expect(s2.goal).toEqual(live);
  });
  it('keeps the goal list and the live goal status', () => {
    const answer = { goals: [{ id: 'g', title: { en: 'G', sv: 'G' }, description: { en: '', sv: '' } }], status: null };
    let s = reduce(initialState, { type: 'goal', answer });
    expect(s.goals).toHaveLength(1);
    expect(s.goal).toBeNull();
    const live = { goalId: 'g', title: { en: 'G', sv: 'G' }, items: [], done: 0, total: 0 };
    s = reduce(s, { type: 'server', now: 0, message: { type: 'goal', status: live } });
    expect(s.goal).toEqual(live);
    expect(s.goals).toHaveLength(1);
  });
  it('applies the goal that comes with the hello graph and ignores unknown message types', () => {
    const live = { goalId: 'g', title: { en: 'G', sv: 'G' }, items: [], done: 0, total: 0 };
    const s1 = reduce(initialState, { type: 'server', now: 0, message: { type: 'graph', seq: 1, graph: graph(['a']), goal: live } });
    expect(s1.goal).toEqual(live);
    const s2 = reduce(s1, { type: 'server', now: 0, message: { type: 'graph', seq: 2, graph: graph(['a']), goal: null } });
    expect(s2.goal).toBeNull();
    const s3 = reduce(s1, { type: 'server', now: 0, message: { type: 'graph', seq: 2, graph: graph(['a']) } });
    expect(s3.goal).toEqual(live);
    const unknown = { type: 'from-the-future' } as unknown as ServerMessage;
    expect(reduce(s1, { type: 'server', now: 0, message: unknown })).toBe(s1);
  });
});
