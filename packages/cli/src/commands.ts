import fs from 'node:fs';
import path from 'node:path';
import { ensureDaemon, liveDaemon, pingDaemon, request } from './daemon/client';
import { startDaemon } from './daemon/daemon';
import { acquireStartLock, isPidAlive, readDaemonInfo, releaseStartLock } from './daemon/info';

type Write = (s: string) => void;

const stdout: Write = (s) => process.stdout.write(s);
const stderr: Write = (s) => process.stderr.write(s);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** `mapskill daemon [dir]`: runs the daemon in this process until it stops. */
export async function runDaemonCommand(dir: string, write: Write = stderr): Promise<number> {
  const root = path.resolve(dir);
  if (!isDirectory(root)) {
    write(`Not a folder: ${root}\n`);
    return 1;
  }
  if (await liveDaemon(root)) {
    write('Mapskill daemon already running\n');
    return 0;
  }
  if (!acquireStartLock(root)) {
    write('Another Mapskill daemon is starting\n');
    return 0;
  }
  const stamp = (line: string): void => write(`[${new Date().toISOString()}] ${line}\n`);
  const handle = await (async () => {
    try {
      return await startDaemon(root, { log: stamp });
    } finally {
      releaseStartLock(root);
    }
  })();
  stamp(`listening on http://127.0.0.1:${handle.info.port}`);
  const onSignal = (): void => {
    void handle.stop('signal');
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  stamp(`stopped (${await handle.done})`);
  return 0;
}

/** `mapskill status [dir]`: starts the daemon if needed and prints where it listens. */
export async function runStatus(dir: string, write: Write = stdout): Promise<number> {
  const root = path.resolve(dir);
  if (!isDirectory(root)) {
    write(`Not a folder: ${root}\n`);
    return 1;
  }
  const info = await ensureDaemon(root, { timeoutMs: 10_000 });
  const status = info ? await pingDaemon(info, 5000) : null;
  if (!info || !status) {
    write(`Mapskill daemon is not answering. See ${path.join(root, '.mapskill', 'daemon.log')}\n`);
    return 1;
  }
  write(`Mapskill daemon: http://127.0.0.1:${info.port} · ${status.fileCount} files · ${status.ready ? 'ready' : 'starting'}\n`);
  return 0;
}

/** `mapskill stop [dir]`: asks the daemon to stop and waits until its process is gone. */
export async function runStop(dir: string, write: Write = stdout): Promise<number> {
  const root = path.resolve(dir);
  const info = readDaemonInfo(root);
  if (!info || !isPidAlive(info.pid)) {
    write('Mapskill daemon is not running\n');
    return 0;
  }
  try {
    await request(info, 'POST', '/api/shutdown');
  } catch {
    // it may already be stopping; wait below
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isPidAlive(info.pid)) await sleep(50);
  if (isPidAlive(info.pid)) {
    write('Mapskill daemon did not stop\n');
    return 1;
  }
  write('Mapskill daemon stopped\n');
  return 0;
}
