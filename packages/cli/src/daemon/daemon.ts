import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  applyFileChanges,
  findDrift,
  loadProject,
  toPublicGraph,
  type DaemonStatus,
  type Project,
  type PublicGraph,
} from '@mapskill/core';
import { readFactsCache, writeFactsCache } from './cache';
import { DAEMON_VERSION, readDaemonInfo, removeDaemonInfo, writeDaemonInfo, type DaemonInfo } from './info';
import { ensureGitignore, ensureMapskillDir } from './paths';
import { ChangeQueue, type ChangeBatch } from './queue';
import { startServer } from './server';
import { TurnTracker } from './turns';
import { watchProject, type ProjectWatcher } from './watcher';

export interface DaemonOptions {
  /** Stop after this long without connected clients or requests. Default 30 minutes. */
  idleMs?: number;
  /** Quiet period before a batch of changes is applied. Default 200 ms. */
  debounceMs?: number;
  /** How often to look for changes the watcher missed (only after changes happened). Default 60 seconds. */
  reconcileMs?: number;
  /** Delay before the facts cache is written after changes. Default 5 seconds. */
  cacheSaveMs?: number;
  /** False runs without a file watcher (changes then only arrive through /api/touched). Default true. */
  watch?: boolean;
  log?: (line: string) => void;
}

export interface DaemonHandle {
  info: DaemonInfo;
  /** Resolves when the project is loaded and the watcher (if any) is running. */
  ready: Promise<void>;
  /** Resolves with the reason once the daemon has stopped. */
  done: Promise<string>;
  stop(reason?: string): Promise<void>;
  project(): Project | undefined;
}

/** Project-relative path with '/' separators, or null when `file` lies outside the project (or is the root itself). */
export function toProjectRel(root: string, file: string): string | null {
  const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return null;
  return rel;
}

export async function startDaemon(rootArg: string, options: DaemonOptions = {}): Promise<DaemonHandle> {
  const root = path.resolve(rootArg);
  const log = options.log ?? (() => {});
  const idleMs = options.idleMs ?? 30 * 60_000;
  ensureMapskillDir(root);
  if (ensureGitignore(root)) log('added .mapskill/ to .gitignore');

  const token = randomBytes(24).toString('hex');
  const turns = new TurnTracker();
  const timers: ReturnType<typeof setInterval>[] = [];
  let project: Project | undefined;
  let seq = 0;
  let lastActivity = Date.now();
  let changedSinceReconcile = false;
  let watcher: ProjectWatcher | undefined;
  let cacheTimer: ReturnType<typeof setTimeout> | undefined;
  let stopping: Promise<void> | undefined;
  let resolveDone!: (reason: string) => void;
  const done = new Promise<string>((resolve) => {
    resolveDone = resolve;
  });

  const saveCache = (): void => {
    if (!project) return;
    try {
      writeFactsCache(root, project.facts);
    } catch (err) {
      log(`cache write failed: ${String(err)}`);
    }
  };
  const scheduleCacheSave = (): void => {
    if (cacheTimer) return;
    cacheTimer = setTimeout(() => {
      cacheTimer = undefined;
      saveCache();
    }, options.cacheSaveMs ?? 5000);
  };

  const onFlush = (batch: ChangeBatch): void => {
    if (!project) return;
    const known = new Set([...Object.keys(project.facts), ...project.skipped]);
    try {
      const result = applyFileChanges(project, batch.paths);
      const current = result.project;
      project = current;
      changedSinceReconcile = true;
      if (!result.empty) {
        seq += 1;
        server.broadcast({ type: 'delta', seq, delta: result.delta });
        scheduleCacheSave();
      }
      const relevant = batch.paths.filter((p) => known.has(p) || p in current.facts || current.skipped.has(p));
      if (relevant.length > 0) {
        const claude = new Set(batch.byClaude);
        server.broadcast({
          type: 'activity',
          at: Date.now(),
          files: relevant.map((p) => ({ path: p, by: claude.has(p) ? 'claude' : 'watcher' })),
        });
      }
    } catch (err) {
      log(`update failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    }
  };
  const queue = new ChangeQueue(onFlush, options.debounceMs ?? 200);

  const loaded = (async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const started = Date.now();
    project = loadProject(root, readFactsCache(root));
    saveCache();
    log(`loaded ${Object.keys(project.facts).length} files in ${Date.now() - started} ms`);
  })();
  const currentFindingIds = (): string[] => project?.graph.findings.map((f) => f.id) ?? [];
  const graphNow = async (): Promise<PublicGraph> => {
    await loaded;
    queue.flushNow();
    return toPublicGraph(project!.graph);
  };

  const server = await startServer({
    token,
    status: (): DaemonStatus => ({
      ok: true,
      root,
      pid: process.pid,
      version: DAEMON_VERSION,
      ready: project !== undefined,
      fileCount: project ? Object.keys(project.facts).length : 0,
      clients: server.clientCount(),
      seq,
    }),
    graph: graphNow,
    hello: async () => {
      const graph = await graphNow();
      return { type: 'graph', seq, graph };
    },
    touched: async ({ files, sessionId }) => {
      await loaded;
      const rels = files.map((f) => toProjectRel(root, f)).filter((r): r is string => r !== null);
      turns.touch(sessionId ?? 'default', rels, currentFindingIds());
      for (const rel of rels) queue.add(rel, 'claude');
    },
    startTurn: async (sessionId) => {
      await loaded;
      queue.flushNow();
      return turns.startTurn(sessionId, currentFindingIds());
    },
    findings: async (turnId, query) => {
      await loaded;
      queue.flushNow();
      return turns.newFindings(turnId, project!.graph.findings, query);
    },
    shutdown: () => {
      void stop('shutdown request');
    },
    activity: () => {
      lastActivity = Date.now();
    },
  });

  const info: DaemonInfo = { pid: process.pid, port: server.port, token, version: DAEMON_VERSION, root, startedAt: Date.now() };
  writeDaemonInfo(root, info);

  const ready = loaded.then(async () => {
    if (options.watch === false || stopping) return;
    const w = await watchProject(
      root,
      (e) => {
        if (e.kind === 'dir-removed') {
          const prefix = `${e.rel}/`;
          const known = [...Object.keys(project?.facts ?? {}), ...(project?.skipped ?? [])];
          for (const rel of known) if (rel.startsWith(prefix)) queue.add(rel, 'watcher');
        } else {
          queue.add(e.rel, 'watcher');
        }
      },
      (err) => log(`watcher error: ${String(err)}`),
    );
    if (stopping) {
      await w.close();
      return;
    }
    watcher = w;
    for (const rel of findDrift(project!)) queue.add(rel, 'watcher');
  });
  ready.catch((err: unknown) => {
    log(`start failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    void stop('start failed');
  });

  timers.push(
    setInterval(() => {
      if (!project || !changedSinceReconcile) return;
      changedSinceReconcile = false;
      for (const rel of findDrift(project)) queue.add(rel, 'watcher');
    }, options.reconcileMs ?? 60_000),
  );
  timers.push(
    setInterval(
      () => {
        if (readDaemonInfo(root)?.pid !== process.pid) {
          void stop('replaced by another daemon');
          return;
        }
        if (server.clientCount() === 0 && Date.now() - lastActivity >= idleMs) void stop('idle');
      },
      Math.min(60_000, Math.max(50, Math.floor(idleMs / 4))),
    ),
  );

  function stop(reason = 'stop'): Promise<void> {
    if (stopping) return stopping;
    stopping = (async () => {
      log(`stopping: ${reason}`);
      for (const t of timers) clearInterval(t);
      if (cacheTimer) clearTimeout(cacheTimer);
      queue.flushNow();
      queue.dispose();
      await watcher?.close();
      await server.close();
      saveCache();
      removeDaemonInfo(root, process.pid);
      resolveDone(reason);
    })();
    return stopping;
  }

  return { info, ready, done, stop, project: () => project };
}
