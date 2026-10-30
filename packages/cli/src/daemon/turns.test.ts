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

  it('evicts per session, so a busy session cannot push out another session turn', () => {
    const t = new TurnTracker();
    const quiet = t.startTurn('quiet', []);
    for (let i = 0; i < 150; i++) t.startTurn('busy', []);
    expect(t.hasTurn(quiet)).toBe(true);
    expect(t.currentTurn('quiet')).toBe(quiet);
    expect(t.newFindings(quiet, [f('x', [])]).map((x) => x.id)).toEqual(['x']);
  });

  it('keeps at most 20 turns per session', () => {
    const t = new TurnTracker();
    const ids = Array.from({ length: 21 }, () => t.startTurn('s', []));
    expect(t.hasTurn(ids[0])).toBe(false);
    expect(ids.slice(1).every((id) => t.hasTurn(id))).toBe(true);
    expect(t.currentTurn('s')).toBe(ids[20]);
  });

  it('caps all turns at 1000 and forgets the current turn of an evicted session', () => {
    const t = new TurnTracker();
    const first = t.startTurn('s0', []);
    for (let i = 1; i <= 1000; i++) t.startTurn(`s${i}`, []);
    expect(t.hasTurn(first)).toBe(false);
    expect(t.currentTurn('s0')).toBeUndefined();
    expect(t.currentTurn('s1000')).toBeDefined();
  });
});
