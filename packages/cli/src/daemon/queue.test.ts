import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeQueue, type ChangeBatch } from './queue';

describe('ChangeQueue', () => {
  let batches: ChangeBatch[];
  beforeEach(() => {
    vi.useFakeTimers();
    batches = [];
  });
  afterEach(() => vi.useRealTimers());

  it('flushes once after the quiet period', () => {
    const q = new ChangeQueue((b) => batches.push(b), 200);
    q.add('b.ts', 'watcher');
    vi.advanceTimersByTime(150);
    q.add('a.ts', 'watcher');
    vi.advanceTimersByTime(150);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(60);
    expect(batches).toEqual([{ paths: ['a.ts', 'b.ts'], byClaude: [] }]);
  });

  it('sorts paths by code unit, independent of locale', () => {
    const q = new ChangeQueue((b) => batches.push(b), 200);
    for (const p of ['b.ts', 'a.ts', 'B.ts', 'Z/x.ts', '_x.ts']) q.add(p, 'watcher');
    q.flushNow();
    expect(batches[0].paths).toEqual(['B.ts', 'Z/x.ts', '_x.ts', 'a.ts', 'b.ts']);
  });

  it('flushes after maxWait even while changes keep coming', () => {
    const q = new ChangeQueue((b) => batches.push(b), 200, 1000);
    for (let i = 0; i < 20; i++) {
      q.add(`f${String(i).padStart(2, '0')}.ts`, 'watcher');
      vi.advanceTimersByTime(100);
    }
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches[0].paths).toHaveLength(10);
  });

  it('marks a path as Claude’s when Claude reported it, whatever the order', () => {
    const q = new ChangeQueue((b) => batches.push(b));
    q.add('a.ts', 'watcher');
    q.add('a.ts', 'claude');
    q.add('b.ts', 'claude');
    q.add('b.ts', 'watcher');
    q.add('c.ts', 'watcher');
    q.flushNow();
    expect(batches).toEqual([{ paths: ['a.ts', 'b.ts', 'c.ts'], byClaude: ['a.ts', 'b.ts'] }]);
  });

  it('does nothing when empty and drops pending paths on dispose', () => {
    const q = new ChangeQueue((b) => batches.push(b));
    q.flushNow();
    q.add('a.ts', 'watcher');
    expect(q.size).toBe(1);
    q.dispose();
    vi.advanceTimersByTime(5000);
    expect(batches).toEqual([]);
  });
});
