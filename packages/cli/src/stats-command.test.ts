// packages/cli/src/stats-command.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runStats } from './stats-command';
import { recordUsage } from './usage';

const day = (n: number): Date => new Date(2026, 10, n, 12, 0, 0);
const home = (): NodeJS.ProcessEnv => ({ MAPSKILL_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-stats-')) });

async function stats(argv: string[], env: NodeJS.ProcessEnv, now: Date): Promise<{ code: number; out: string }> {
  let out = '';
  const code = await runStats(argv, { env, now, write: (s) => void (out += s) });
  return { code, out };
}

function used(): NodeJS.ProcessEnv {
  const env = home();
  recordUsage('session', '/a', { env, now: day(1) });
  recordUsage('map-open', '/a', { env, now: day(1) });
  recordUsage('map-open', '/a', { env, now: day(9) });
  recordUsage('request-fix', '/a', { env, now: day(9) });
  return env;
}

describe('runStats', () => {
  it('says there is nothing to show without a usage file, in both languages, with exit code 0', async () => {
    const env = home();
    expect(await stats(['--lang', 'sv'], env, day(2))).toEqual({ code: 0, out: 'Inget att visa än: Mapskill har inte använts på den här datorn.\n' });
    expect(await stats(['--lang', 'en'], env, day(2))).toEqual({ code: 0, out: 'Nothing to show yet: Mapskill has not been used on this computer.\n' });
  });

  it('prints a Swedish text that starts by saying nothing was sent, with a line per week and the week-two answer', async () => {
    const { code, out } = await stats(['--lang', 'sv'], used(), day(10));
    expect(code).toBe(0);
    expect(out.split('\n')[0]).toContain('Inget har skickats');
    expect(out.split('\n')[0]).toContain('kopiera');
    expect(out).toContain('Vecka 1: 1 sessionsdagar, 1 kartdagar');
    expect(out).toContain('Vecka 2: 0 sessionsdagar, 1 kartdagar');
    expect(out).toContain('Öppnade kartan under vecka 2: ja');
    expect(out).toContain('1 rättningar');
  });

  it('prints an English text, and "not yet" before day 8', async () => {
    const env = home();
    recordUsage('map-open', '/a', { env, now: day(1) });
    const { out } = await stats(['--lang', 'en'], env, day(3));
    expect(out.split('\n')[0]).toContain('Nothing has been sent');
    expect(out).toContain('Opened the map in week 2: not yet');
    expect((await stats(['--lang', 'en'], env, day(12))).out).toContain('Opened the map in week 2: no');
  });

  it('prints the summary as JSON with --json', async () => {
    const { code, out } = await stats(['--json'], used(), day(10));
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ firstDay: '2026-11-01', mapDays: 2, weekTwoMap: true, requests: { fix: 1 } });
  });
});
