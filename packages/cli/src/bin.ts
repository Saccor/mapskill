#!/usr/bin/env node
import { runDaemonCommand, runStatus, runStop } from './commands';
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
  '',
].join('\n');

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
};

const run = command !== undefined && Object.hasOwn(commands, command) ? commands[command] : undefined;
if (!run) {
  process.stderr.write(USAGE);
  process.exit(1);
}
Promise.resolve()
  .then(run)
  .then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
