import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import {
  acquireStartLock,
  DAEMON_VERSION,
  isPidAlive,
  readDaemonInfo,
  releaseStartLock,
  removeDaemonInfo,
  writeDaemonInfo,
  type DaemonInfo,
} from './info';

const deadPid = (): number => spawnSync(process.execPath, ['-e', '0']).pid!;
const lockFile = (root: string): string => path.join(root, '.mapskill', 'daemon.lock');

describe('daemon.json', () => {
  it('round-trips and is only removed by its owner', () => {
    const root = tmpProject({});
    const info: DaemonInfo = { pid: 4242, port: 1234, token: 't', version: DAEMON_VERSION, root, startedAt: 1 };
    writeDaemonInfo(root, info);
    expect(readDaemonInfo(root)).toEqual(info);
    removeDaemonInfo(root, 1);
    expect(readDaemonInfo(root)).toEqual(info);
    removeDaemonInfo(root, 4242);
    expect(readDaemonInfo(root)).toBeNull();
  });

  it('treats a broken file as missing', () => {
    const root = tmpProject({ '.mapskill/daemon.json': 'not json' });
    expect(readDaemonInfo(root)).toBeNull();
  });
});

describe('isPidAlive', () => {
  it('knows live and dead processes', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(deadPid())).toBe(false);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
  });
});

describe('start lock', () => {
  it('is refused while another live process holds a fresh lock', () => {
    const root = tmpProject({});
    fs.mkdirSync(path.join(root, '.mapskill'));
    fs.writeFileSync(lockFile(root), String(process.ppid));
    expect(acquireStartLock(root)).toBe(false);
  });

  it('is taken over from a dead process and released by its owner', () => {
    const root = tmpProject({});
    fs.mkdirSync(path.join(root, '.mapskill'));
    fs.writeFileSync(lockFile(root), String(deadPid()));
    expect(acquireStartLock(root)).toBe(true);
    expect(fs.readFileSync(lockFile(root), 'utf8')).toBe(String(process.pid));
    releaseStartLock(root);
    expect(fs.existsSync(lockFile(root))).toBe(false);
  });

  it('treats an old lock as stale', () => {
    const root = tmpProject({});
    fs.mkdirSync(path.join(root, '.mapskill'));
    fs.writeFileSync(lockFile(root), String(process.ppid));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockFile(root), old, old);
    expect(acquireStartLock(root)).toBe(true);
  });

  it('can be taken when no lock exists', () => {
    const root = tmpProject({});
    expect(acquireStartLock(root)).toBe(true);
    releaseStartLock(root);
  });

  it('treats a just-created empty lock as held until it is stale', () => {
    const root = tmpProject({ 'package.json': '{}' });
    fs.mkdirSync(path.join(root, '.mapskill'), { recursive: true });
    const file = path.join(root, '.mapskill', 'daemon.lock');
    fs.writeFileSync(file, '');
    expect(acquireStartLock(root)).toBe(false);
    const old = new Date(Date.now() - 20_000);
    fs.utimesSync(file, old, old);
    expect(acquireStartLock(root)).toBe(true);
    releaseStartLock(root);
  });
});
