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
const quiet = (): void => {};
afterEach(async () => {
  for (const root of roots.splice(0)) await runStop(root, quiet);
});
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
    writeDaemonInfo(root, { pid: dead, port: 1, token: 'x', version: DAEMON_VERSION, root, startedAt: Date.now() });
    const info = await ensureDaemon(root, { timeoutMs: 15_000 });
    expect(info).not.toBeNull();
    expect(info!.pid).not.toBe(dead);
    expect(await pingDaemon(info!)).not.toBeNull();
  }, 30_000);

  it('ends up with one daemon when two callers start at once', async () => {
    const root = newProject();
    const [a, b] = await Promise.all([ensureDaemon(root, { timeoutMs: 15_000 }), ensureDaemon(root, { timeoutMs: 15_000 })]);
    expect(a).not.toBeNull();
    expect(b?.pid).toBe(a!.pid);
  }, 30_000);
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

describe('selfCommand', () => {
  it('uses the registered entry file', () => {
    setSelfEntry(path.join(os.tmpdir(), 'bundle', 'mapskill.mjs'));
    expect(selfCommand()).toEqual({ command: process.execPath, args: [path.join(os.tmpdir(), 'bundle', 'mapskill.mjs')] });
    setSelfEntry(undefined);
    expect(selfCommand().args.at(-1)).toMatch(/bin\.ts$/);
  });
});
