import type { Certainty, Finding } from '@mapskill/core';
import { describe, expect, it } from 'vitest';
import { TurnTracker } from './turns';

const f = (id: string, files: string[], certainty: Certainty = 'certain'): Finding => ({
  id,
  kind: 'exact-duplicate',
  certainty,
  nodeIds: [],
  files,
  message: { en: id, sv: id },
  instruction: '',
});

describe('TurnTracker', () => {
  it('returns findings that appeared after the turn started', () => {
    const t = new TurnTracker();
    const id = t.startTurn('s', ['old']);
    expect(t.newFindings(id, [f('old', ['a.ts']), f('new', ['b.ts'])]).map((x) => x.id)).toEqual(['new']);
  });

  it('filters to touched files and to a certainty', () => {
    const t = new TurnTracker();
    const id = t.startTurn('s', []);
    t.touch('s', ['a.ts'], []);
    const all = [f('x', ['a.ts']), f('y', ['b.ts']), f('z', ['a.ts'], 'likely')];
    expect(t.newFindings(id, all, { touchedOnly: true, certainty: 'certain' }).map((x) => x.id)).toEqual(['x']);
    expect(t.newFindings(id, all).map((x) => x.id)).toEqual(['x', 'y', 'z']);
  });

  it('keeps sessions apart', () => {
    const t = new TurnTracker();
    t.startTurn('s1', []);
    const other = t.startTurn('s2', []);
    t.touch('s1', ['a.ts'], []);
    expect(t.newFindings(other, [f('x', ['a.ts'])], { touchedOnly: true })).toEqual([]);
  });

  it('starts a turn when a session touches files before any turn began', () => {
    const t = new TurnTracker();
    const id = t.touch('s', ['a.ts'], ['old']);
    expect(t.currentTurn('s')).toBe(id);
    expect(t.newFindings(id, [f('old', ['a.ts']), f('new', ['a.ts'])], { touchedOnly: true }).map((x) => x.id)).toEqual(['new']);
  });

  it('returns nothing for unknown or forgotten turns', () => {
    const t = new TurnTracker();
    expect(t.newFindings('nope', [f('x', [])])).toEqual([]);
    const first = t.startTurn('s', []);
    for (let i = 0; i < 100; i++) t.startTurn('s', []);
    expect(t.newFindings(first, [f('x', [])])).toEqual([]);
    expect(t.currentTurn('s')).toBeDefined();
  });
});
