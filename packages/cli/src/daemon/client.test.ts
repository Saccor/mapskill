import { spawnSync } from 'node:child_process';
import { tmpProject } from '@mapskill/core/test-helpers';
import { afterEach, describe, expect, it } from 'vitest';
import { runStatus, runStop } from '../commands';
import { waitFor } from '../test-utils';
import { ensureDaemon, pingDaemon } from './client';
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
