import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { afterEach, describe, expect, it } from 'vitest';
import { runStatus, runStop } from '../commands';
import { waitFor } from '../test-utils';
import { ensureDaemon, liveDaemon, pingDaemon, selfCommand, setSelfEntry, spawnDaemon } from './client';
import { startDaemon } from './daemon';
import { DAEMON_VERSION, isPidAlive, readDaemonInfo, writeDaemonInfo } from './info';

const deadPid = (): number => spawnSync(process.execPath, ['-e', '0']).pid!;
const project = (): string => tmpProject({ 'package.json': '{}', 'lib/a.ts': 'export const a = 1;\n' });
const roots: string[] = [];
/** Roots where a losing daemon process may still be booting when the test ends. */
const racyRoots = new Set<string>();
const quiet = (): void => {};
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await runStop(root, quiet);
    if (!racyRoots.delete(root)) continue;
    // The loser of a start race can take over once the winner stops; give it time to show up, then stop it too.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (readDaemonInfo(root)) await runStop(root, quiet);
    }
  }
}, 20_000);
function newProject(): string {
  const root = project();
  roots.push(root);
  return root;
}

describe('ensureDaemon', () => {
  it('starts a daemon in its own process and stop ends it', async () => {
    const root = newProject();
    const info = await ensureDaemon(root, { timeoutMs: 15_000 });
    expect(info).not.toBeNull();
    expect(info!.pid).not.toBe(process.pid);
    expect(await pingDaemon(info!)).toMatchObject({ ok: true, pid: info!.pid });
    expect(await ensureDaemon(root)).toEqual(info);
    expect(await runStop(root, quiet)).toBe(0);
    expect(isPidAlive(info!.pid)).toBe(false);
    expect(readDaemonInfo(root)).toBeNull();
  }, 30_000);

  it('starts a new daemon after the old one crashed', async () => {
    const root = newProject();
    const first = await ensureDaemon(root, { timeoutMs: 15_000 });
    process.kill(first!.pid);
    await waitFor(() => !isPidAlive(first!.pid), 10_000);
    const second = await ensureDaemon(root, { timeoutMs: 15_000 });
    expect(second).not.toBeNull();
    expect(second!.pid).not.toBe(first!.pid);
    expect(await pingDaemon(second!)).not.toBeNull();
  }, 40_000);

  it('replaces a daemon.json whose pid is dead', async () => {
    const root = newProject();
    const dead = deadPid();
    writeDaemonInfo(root, { pid: dead, port: 1, token: 'ab', version: DAEMON_VERSION, root, startedAt: Date.now() });
    const info = await ensureDaemon(root, { timeoutMs: 15_000 });
    expect(info).not.toBeNull();
    expect(info!.pid).not.toBe(dead);
    expect(await pingDaemon(info!)).not.toBeNull();
  }, 30_000);

  it('ends up with one daemon when two callers start at once', async () => {
    const root = newProject();
    racyRoots.add(root);
    const [a, b] = await Promise.all([ensureDaemon(root, { timeoutMs: 15_000 }), ensureDaemon(root, { timeoutMs: 15_000 })]);
    expect(a).not.toBeNull();
    expect(b?.pid).toBe(a!.pid);
  }, 30_000);
});

describe('liveDaemon start time', () => {
  const entry = (root: string, startedAt: number) =>
    writeDaemonInfo(root, { pid: process.pid, port: 1, token: 'ab', version: DAEMON_VERSION, root, startedAt });

  it('trusts a recent start that does not answer yet', async () => {
    const root = newProject();
    entry(root, Date.now());
    expect(await liveDaemon(root)).not.toBeNull();
  });

  it('does not trust a start time in the future', async () => {
    const root = newProject();
    entry(root, Date.now() + 60_000);
    expect(await liveDaemon(root)).toBeNull();
  });
});

describe('ensureDaemon fail-open', () => {
  it('resolves null instead of crashing when the process cannot be spawned', async () => {
    const root = newProject();
    const broken = (r: string): void => spawnDaemon(r, { command: 'mapskill-no-such-command', args: [] });
    expect(await ensureDaemon(root, { timeoutMs: 500, spawn: broken })).toBeNull();
    const logFile = path.join(root, '.mapskill', 'daemon.log');
    await waitFor(() => fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes('mapskill-no-such-command'), 5000);
    expect(fs.readFileSync(logFile, 'utf8')).toMatch(/ENOENT/);
  }, 15_000);
});

describe('spawnDaemon', () => {
  it('runs the daemon from the home folder, so it does not pin the project folder', async () => {
    const root = newProject();
    const script = 'console.log("cwd=" + process.cwd())';
    spawnDaemon(root, { command: process.execPath, args: ['-e', script] });
    const logFile = path.join(root, '.mapskill', 'daemon.log');
    await waitFor(() => fs.readFileSync(logFile, 'utf8').includes('cwd='), 10_000);
    const line = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('cwd='));
    expect(line).toBe(`cwd=${os.homedir()}`);
  });
});

describe('CLI commands', () => {
  it('status starts the daemon and prints its address', async () => {
    const root = newProject();
    let out = '';
    expect(await runStatus(root, (s) => (out += s))).toBe(0);
    expect(out).toMatch(/^Mapskill daemon: http:\/\/127\.0\.0\.1:\d+ · \d+ files · (ready|starting)\n$/);
  }, 30_000);

  it('stop says so when nothing runs', async () => {
    let out = '';
    expect(await runStop(project(), (s) => (out += s))).toBe(0);
    expect(out).toBe('Mapskill daemon is not running\n');
  });

  it('status refuses a folder that does not exist', async () => {
    let out = '';
    expect(await runStatus('/definitely/not/here', (s) => (out += s))).toBe(1);
    expect(out).toContain('Not a folder');
  });
});

describe('version check', () => {
  it('retires a daemon that runs another version', async () => {
    const root = project();
    const handle = await startDaemon(root, { watch: false });
    writeDaemonInfo(root, { ...handle.info, version: '0.0.1' });
    expect(await liveDaemon(root)).toBeNull();
    expect(await handle.done).toBe('shutdown request');
  });

  it('keeps a daemon that runs this version', async () => {
    const root = project();
    const handle = await startDaemon(root, { watch: false });
    expect((await liveDaemon(root))?.pid).toBe(process.pid);
    await handle.stop('test done');
  });
});

describe('home folder guard', () => {
  it('ensureDaemon refuses the home folder and spawns nothing', async () => {
    const home = project();
    let spawned = 0;
    expect(await ensureDaemon(home, { home, timeoutMs: 200, spawn: () => void (spawned += 1) })).toBeNull();
    expect(spawned).toBe(0);
  });

  it('startDaemon refuses the home folder and writes nothing', async () => {
    const home = project();
    await expect(startDaemon(home, { home, watch: false, uiDir: null })).rejects.toThrow(/home folder/);
    expect(fs.existsSync(path.join(home, '.mapskill'))).toBe(false);
  });

  it('status refuses a disk root with the plain message', async () => {
    const out: string[] = [];
    expect(await runStatus(path.parse(process.cwd()).root, (s) => void out.push(s))).toBe(1);
    expect(out.join('')).toContain('does not map your home folder or a disk root');
  });
});

describe('selfCommand', () => {
  it('uses the registered entry file', () => {
    try {
      setSelfEntry(path.join(os.tmpdir(), 'bundle', 'mapskill.mjs'));
      expect(selfCommand()).toEqual({ command: process.execPath, args: [path.join(os.tmpdir(), 'bundle', 'mapskill.mjs')] });
    } finally {
      setSelfEntry(undefined);
    }
    expect(selfCommand().args.at(-1)).toMatch(/bin\.ts$/);
  });
});
