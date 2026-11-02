// packages/cli/src/usage.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readUsage, recordUsage, summarize, usageFile, type UsageLine } from './usage';

const home = (): NodeJS.ProcessEnv => ({ MAPSKILL_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-usage-')) });
const day = (n: number): Date => new Date(2026, 10, n, 12, 0, 0); // 2026-11-<n>, local time
const rows = (env: NodeJS.ProcessEnv): string[] => fs.readFileSync(usageFile(env), 'utf8').split('\n').filter(Boolean);

describe('recordUsage', () => {
  it('writes one line with the local date, the event and a short hash of the project root', () => {
    const env = home();
    recordUsage('map-open', path.resolve('/some/project'), { env, now: day(2) });
    expect(usageFile(env)).toBe(path.join(env.MAPSKILL_HOME!, 'usage.jsonl'));
    const [line] = rows(env);
    const parsed = JSON.parse(line) as UsageLine;
    expect(parsed).toEqual({ d: '2026-11-02', e: 'map-open', p: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(Object.keys(parsed)).toEqual(['d', 'e', 'p']);
    expect(line).not.toContain('project');
  });

  it('writes session and map-open at most once per day and project, but a new day or project counts', () => {
    const env = home();
    recordUsage('map-open', '/a', { env, now: day(2) });
    recordUsage('map-open', '/a', { env, now: day(2) });
    expect(rows(env)).toHaveLength(1);
    recordUsage('map-open', '/a', { env, now: day(3) });
    recordUsage('map-open', '/b', { env, now: day(3) });
    recordUsage('session', '/a', { env, now: day(3) });
    recordUsage('session', '/a', { env, now: day(3) });
    expect(rows(env)).toHaveLength(4);
  });

  it('writes requests and reminders every time', () => {
    const env = home();
    recordUsage('request-build', '/a', { env, now: day(2) });
    recordUsage('request-build', '/a', { env, now: day(2) });
    recordUsage('reminder', '/a', { env, now: day(2) });
    recordUsage('reminder', '/a', { env, now: day(2) });
    expect(rows(env)).toHaveLength(4);
  });

  it('keeps only the latest 2000 lines when the file passes 512 kB', () => {
    const env = home();
    const file = usageFile(env);
    const filler = JSON.stringify({ d: '2026-01-01', e: 'reminder', p: 'deadbeef' });
    fs.writeFileSync(file, `${Array.from({ length: Math.ceil(600_000 / (filler.length + 1)) }, () => filler).join('\n')}\n`);
    expect(fs.statSync(file).size).toBeGreaterThan(512 * 1024);
    recordUsage('request-fix', '/a', { env, now: day(2) });
    const kept = rows(env);
    expect(kept).toHaveLength(2000);
    expect(JSON.parse(kept[kept.length - 1])).toMatchObject({ d: '2026-11-02', e: 'request-fix' });
    expect(fs.readdirSync(path.dirname(file))).toEqual(['usage.jsonl']);
  });

  it('never throws, even when MAPSKILL_HOME is a file', () => {
    const env = home();
    const notAFolder = path.join(env.MAPSKILL_HOME!, 'file');
    fs.writeFileSync(notAFolder, 'x');
    expect(() => recordUsage('session', '/a', { env: { MAPSKILL_HOME: notAFolder } })).not.toThrow();
  });
});

describe('readUsage', () => {
  it('skips broken lines and unknown events, and gives [] without a file', () => {
    const env = home();
    expect(readUsage(env)).toEqual([]);
    fs.writeFileSync(
      usageFile(env),
      ['{"d":"2026-11-02","e":"session","p":"aaaaaaaa"}', '{broken', '{"d":"2026-11-02","e":"nope","p":"aaaaaaaa"}', '', '{"d":"2026-11-03","e":"map-open","p":"bbbbbbbb"}'].join('\n'),
    );
    expect(readUsage(env)).toEqual([
      { d: '2026-11-02', e: 'session', p: 'aaaaaaaa' },
      { d: '2026-11-03', e: 'map-open', p: 'bbbbbbbb' },
    ]);
  });
});

describe('summarize', () => {
  const line = (d: number, e: UsageLine['e'], p = 'aaaaaaaa'): UsageLine => ({ d: `2026-11-${String(d).padStart(2, '0')}`, e, p });

  it('counts days, requests, reminders, projects and weeks', () => {
    const s = summarize(
      [line(1, 'session'), line(1, 'map-open'), line(3, 'map-open'), line(9, 'map-open', 'bbbbbbbb'), line(9, 'session'), line(9, 'request-ask'), line(9, 'request-build'), line(9, 'reminder')],
      day(9),
    );
    expect(s).toMatchObject({
      firstDay: '2026-11-01',
      days: 9,
      sessionDays: 2,
      mapDays: 3,
      requests: { ask: 1, fix: 0, build: 1 },
      reminders: 1,
      projects: 2,
      weekTwoMap: true,
    });
    expect(s.weeks).toEqual([
      { week: 1, sessionDays: 1, mapDays: 2 },
      { week: 2, sessionDays: 1, mapDays: 1 },
    ]);
  });

  it('answers the week-two question: null before day 8, false after a week without the map', () => {
    const lines = [line(1, 'map-open')];
    expect(summarize(lines, day(5)).weekTwoMap).toBeNull();
    expect(summarize(lines, day(8)).weekTwoMap).toBe(false);
    expect(summarize(lines, day(10)).weekTwoMap).toBe(false);
    expect(summarize([line(1, 'map-open'), line(3, 'map-open'), line(9, 'map-open')], day(10)).weekTwoMap).toBe(true);
  });
});
