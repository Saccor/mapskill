#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

// Keep this check plain and first: it must run before anything is imported, and parse on old Node versions.
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 12)) {
  process.stderr.write(
    `Mapskill needs Node.js 22.12 or newer (you have ${process.versions.node}). Download it from https://nodejs.org
`,
  );
  process.exit(1);
}

// Each command is imported on demand: hooks must not load @mapskill/core (and with it the TypeScript compiler).
const { setSelfEntry } = await import('./daemon/client');
setSelfEntry(fileURLToPath(import.meta.url));

const USAGE = [
  'Usage:',
  '  mapskill                 open the map for this folder (run it in your project folder)',
  '  mapskill stats           show how Mapskill has been used (a text you can send to us) [--lang en|sv] [--json]',
  '  mapskill scan [dir] [--json] [--lang en|sv]',
  '  mapskill status [dir]    start the background daemon if needed and show where it listens',
  '  mapskill stop [dir]      stop the background daemon',
  '  mapskill open [dir]      open the map in your browser (--no-browser only prints the address)',
  '  mapskill daemon [dir]    run the daemon in this terminal',
  '  mapskill lock <path...> [--label text]   Claude must ask before changing these files or folders',
  '  mapskill unlock <path...>',
  '  mapskill locks [dir]',
  '  mapskill mcp             MCP server for Claude Code (stdio)',
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
const commands: Record<string, () => Promise<number>> = {
  '--help': async () => (process.stdout.write(USAGE), 0),
  '-h': async () => (process.stdout.write(USAGE), 0),
  '--version': async () => (process.stdout.write(`${(await import('./version')).VERSION}
`), 0),
  '-v': async () => (process.stdout.write(`${(await import('./version')).VERSION}
`), 0),
  stats: async () => (await import('./stats-command')).runStats(rest),
  scan: async () => (await import('./scan')).runScan(rest),
  status: async () => (await import('./commands')).runStatus(dir),
  stop: async () => (await import('./commands')).runStop(dir),
  open: async () => (await import('./open-command')).runOpen(rest),
  daemon: async () => (await import('./commands')).runDaemonCommand(dir),
  lock: async () => (await import('./lock-commands')).runLock(rest),
  unlock: async () => (await import('./lock-commands')).runUnlock(rest),
  locks: async () => (await import('./lock-commands')).runLocks(rest),
  mcp: async () => (await import('./mcp/server')).runMcp(),
  hook: async () => {
    const { runHook } = await import('./hooks/run');
    const result = await runHook(rest[0] ?? '', { stdin: process.stdin, env: process.env });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.exitCode;
  },
};

// No command at all (or only flags such as --no-browser) starts the friendly entry point.
const startFlags = command === undefined || command === '--no-browser';
const run = startFlags
  ? async () => (await import('./start-command')).runStart(process.argv.slice(2))
  : command !== undefined && Object.hasOwn(commands, command)
    ? commands[command]
    : undefined;
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
