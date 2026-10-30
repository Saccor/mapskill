import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DaemonStatus } from '@mapskill/core';
import { isPidAlive, readDaemonInfo, type DaemonInfo } from './info';
import { ensureMapskillDir, mapskillPath } from './paths';

export class DaemonRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the daemon's HTTP API with the token. Throws DaemonRequestError for non-2xx answers. */
export async function request<T>(
  info: { port: number; token: string },
  method: 'GET' | 'POST',
  pathname: string,
  body?: unknown,
  timeoutMs = 2000,
): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${info.port}${pathname}`, {
    method,
    headers: { 'x-mapskill-token': info.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let json: T & { error?: string };
  try {
    json = (await res.json()) as T & { error?: string };
  } catch {
    throw new DaemonRequestError(res.status, res.statusText);
  }
  if (!res.ok) throw new DaemonRequestError(res.status, json.error ?? res.statusText);
  return json;
}

/** A daemon younger than this may still be busy with its first scan and is given the benefit of the doubt. */
export const STARTUP_GRACE_MS = 60_000;
const MAX_LOG_BYTES = 1_000_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function pingDaemon(info: DaemonInfo, timeoutMs = 1500): Promise<DaemonStatus | null> {
  try {
    const status = await request<DaemonStatus>(info, 'GET', '/api/status', undefined, timeoutMs);
    return status.ok && status.pid === info.pid ? status : null;
  } catch {
    return null;
  }
}

/** The daemon from daemon.json, if its process lives and it answers (or started less than a minute ago). */
export async function liveDaemon(root: string): Promise<DaemonInfo | null> {
  const info = readDaemonInfo(root);
  if (!info || !isPidAlive(info.pid)) return null;
  if (await pingDaemon(info)) return info;
  return Date.now() - info.startedAt < STARTUP_GRACE_MS ? info : null;
}

/** How to run this CLI again: node + bin.js, or node + tsx loader + bin.ts during development. */
export function selfCommand(): { command: string; args: string[] } {
  const here = fileURLToPath(import.meta.url);
  const ext = path.extname(here);
  const bin = path.join(path.dirname(here), '..', `bin${ext}`);
  if (ext === '.ts') {
    const loader = createRequire(import.meta.url).resolve('tsx');
    return { command: process.execPath, args: ['--import', pathToFileURL(loader).href, bin] };
  }
  return { command: process.execPath, args: [bin] };
}

/** Starts `mapskill daemon <root>` detached from this process, logging to .mapskill/daemon.log. */
export function spawnDaemon(root: string, override?: { command: string; args: string[] }): void {
  ensureMapskillDir(root);
  const logFile = mapskillPath(root, 'daemon.log');
  let flags = 'a';
  try {
    if (fs.statSync(logFile).size > MAX_LOG_BYTES) flags = 'w';
  } catch {
    // no log yet
  }
  const log = fs.openSync(logFile, flags);
  try {
    const { command, args } = override ?? selfCommand();
    const child = spawn(command, [...args, 'daemon', root], {
      // Not the project folder: on Windows a process's cwd keeps the folder from being renamed or deleted.
      // The root is passed as an absolute argument, so the daemon does not need it.
      cwd: os.homedir(),
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
    });
    // Async spawn failures (ENOENT, EACCES) arrive as 'error' events; unhandled they would crash the caller.
    child.on('error', (err) => {
      try {
        fs.appendFileSync(logFile, `${new Date().toISOString()} could not start the daemon: ${err.message}\n`);
      } catch {
        // logging is best effort
      }
    });
    child.unref();
  } finally {
    fs.closeSync(log);
  }
}

/** Returns a running daemon for `root`, starting one if needed. Never throws: null means "carry on without Mapskill". */
export async function ensureDaemon(
  rootArg: string,
  options: { timeoutMs?: number; spawn?: (root: string) => void } = {},
): Promise<DaemonInfo | null> {
  const root = path.resolve(rootArg);
  try {
    const existing = await liveDaemon(root);
    if (existing) return existing;
    const old = readDaemonInfo(root);
    (options.spawn ?? spawnDaemon)(root);
    const deadline = Date.now() + (options.timeoutMs ?? 3000);
    let candidate: DaemonInfo | null = null;
    while (Date.now() < deadline) {
      await sleep(50);
      const info = readDaemonInfo(root);
      if (!info || info.pid === old?.pid || !isPidAlive(info.pid)) continue;
      candidate = info;
      if (await pingDaemon(info, 500)) return info;
    }
    return candidate;
  } catch {
    return null;
  }
}
