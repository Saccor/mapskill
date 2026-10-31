import fs from 'node:fs';
import { ensureMapskillDir, mapskillPath, readJson, writeJsonAtomic } from './paths';

export const DAEMON_VERSION = '0.2.0';

/** Contents of .mapskill/daemon.json: how other processes find the running daemon. */
export interface DaemonInfo {
  pid: number;
  port: number;
  token: string;
  version: string;
  root: string;
  startedAt: number;
}

const INFO_FILE = 'daemon.json';
const LOCK_FILE = 'daemon.lock';

export function readDaemonInfo(root: string): DaemonInfo | null {
  const info = readJson<Partial<DaemonInfo>>(mapskillPath(root, INFO_FILE));
  if (!info || typeof info.pid !== 'number' || typeof info.port !== 'number' || typeof info.token !== 'string') return null;
  return info as DaemonInfo;
}

export function writeDaemonInfo(root: string, info: DaemonInfo): void {
  ensureMapskillDir(root);
  writeJsonAtomic(mapskillPath(root, INFO_FILE), info, 0o600); // the token is private to the user
}

/** Removes daemon.json only when it still belongs to `pid` (a newer daemon may have replaced it). */
export function removeDaemonInfo(root: string, pid: number): void {
  if (readDaemonInfo(root)?.pid === pid) fs.rmSync(mapskillPath(root, INFO_FILE), { force: true });
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Claims the start lock. False when another live process took it less than `staleMs` ago. */
export function acquireStartLock(root: string, staleMs = 10_000): boolean {
  ensureMapskillDir(root);
  const file = mapskillPath(root, LOCK_FILE);
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false;
  }
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    const age = Date.now() - fs.statSync(file).mtimeMs;
    const holder = Number(text);
    // An empty or half-written lock was just created by another process that has not written its pid yet.
    if (!Number.isInteger(holder) || holder <= 0) {
      if (age < staleMs) return false;
    } else if (holder !== process.pid && isPidAlive(holder) && age < staleMs) {
      return false;
    }
  } catch {
    // the lock vanished or cannot be read: take it over
  }
  fs.writeFileSync(file, String(process.pid));
  return true;
}

export function releaseStartLock(root: string): void {
  const file = mapskillPath(root, LOCK_FILE);
  try {
    if (Number(fs.readFileSync(file, 'utf8').trim()) === process.pid) fs.rmSync(file, { force: true });
  } catch {
    // already gone
  }
}
