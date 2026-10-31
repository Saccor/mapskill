#!/usr/bin/env node
import { runDaemonCommand, runStatus, runStop } from './commands';
import { runHook } from './hooks/run';
import { runLock, runLocks, runUnlock } from './lock-commands';
import { runScan } from './scan';

const USAGE = [
  'Usage:',
  '  mapskill scan [dir] [--json] [--lang en|sv]',
  '  mapskill status [dir]    start the background daemon if needed and show where it listens',
  '  mapskill stop [dir]      stop the background daemon',
  '  mapskill daemon [dir]    run the daemon in this terminal',
  '  mapskill lock <path...> [--label text]   Claude must ask before changing these files or folders',
  '  mapskill unlock <path...>',
  '  mapskill locks [dir]',
  '  mapskill hook <event>    used by the Claude Code plugin (reads the hook JSON on stdin)',
  '',
].join('\n');

/** Exits once stdout and stderr are flushed (process.exit can cut off piped output on Linux). */
function exitAfterFlush(code: number): void {
  let pending = 2;
  const done = (): void => {
    pending -= 1;
    if (pending === 0) process.exit(code);
  };
  process.stdout.write('', done);
  process.stderr.write('', done);
}

const [command, ...rest] = process.argv.slice(2);
const dir = rest[0] ?? '.';
const commands: Record<string, () => number | Promise<number>> = {
  scan: () => runScan(rest),
  status: () => runStatus(dir),
  stop: () => runStop(dir),
  daemon: () => runDaemonCommand(dir),
  lock: () => runLock(rest),
  unlock: () => runUnlock(rest),
  locks: () => runLocks(rest),
  hook: async () => {
    const result = await runHook(rest[0] ?? '', { stdin: process.stdin, env: process.env });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.exitCode;
  },
};

const run = command !== undefined && Object.hasOwn(commands, command) ? commands[command] : undefined;
if (!run) {
  process.stderr.write(USAGE);
  exitAfterFlush(1);
} else {
  Promise.resolve()
    .then(run)
    .then(
      (code) => exitAfterFlush(code),
      (err: unknown) => {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        exitAfterFlush(1);
      },
    );
}
