import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { afterEach, describe, expect, it } from 'vitest';
import { runStop } from './commands';
import { mapUrl, runOpen } from './open-command';
import { UNSAFE_ROOT_MESSAGE } from './unsafe-root';

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await runStop(r, () => {});
});

describe('mapskill open', () => {
  it('builds the map address', () => {
    expect(mapUrl({ port: 4321, token: 'abc' })).toBe('http://127.0.0.1:4321/?t=abc');
  });

  it('starts the daemon, prints the address and opens it', async () => {
    const root = tmpProject({ 'package.json': '{}', 'lib/a.ts': 'export const a = 1;\n' });
    roots.push(root);
    const out: string[] = [];
    const opened: string[] = [];
    expect(await runOpen([root], { open: (u) => void opened.push(u), write: (s) => void out.push(s) })).toBe(0);
    expect(out.join('')).toMatch(/Mapskill map: http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+/);
    expect(opened).toHaveLength(1);
    const quiet: string[] = [];
    expect(await runOpen([root, '--no-browser'], { open: (u) => void quiet.push(u), write: () => {} })).toBe(0);
    expect(quiet).toEqual([]);
  }, 30_000);

  it('refuses the home folder without starting a daemon', async () => {
    const home = tmpProject({ 'package.json': '{}' });
    const out: string[] = [];
    const opened: string[] = [];
    expect(await runOpen([home], { home, open: (u) => void opened.push(u), write: (s) => void out.push(s) })).toBe(1);
    expect(out.join('')).toBe(`${UNSAFE_ROOT_MESSAGE}\n`);
    expect(opened).toEqual([]);
    expect(fs.existsSync(path.join(home, '.mapskill'))).toBe(false);
  });
});
