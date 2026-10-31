import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyFileChanges,
  evaluateGoal,
  findDrift,
  findingCodeHash,
  findGoal,
  findSimilar,
  goalSummaries,
  loadProject,
  mapOverview,
  nodeDetails,
  setDismissed,
  toPublicGraph,
  type DaemonStatus,
  type GoalStatus,
  type LocksAnswer,
  type Project,
  type PublicGraph,
  type SourceAnswer,
  type StopAnswer,
} from '@mapskill/core';
import { addLocks, findLock, readLocks, removeLocks } from '../locks';
import { canonicalRoot, toProjectRel } from '../project-path';
import { readFactsCache, writeFactsCache } from './cache';
import { DAEMON_VERSION, readDaemonInfo, removeDaemonInfo, writeDaemonInfo, type DaemonInfo } from './info';
import { ensureGitignore, ensureMapskillDir } from './paths';
import { ChangeQueue, type ChangeBatch } from './queue';
import { RequestQueue } from './requests';
import { HttpError, startServer } from './server';
import { findUiDir } from './ui-dir';
import { mergeLayout, readDismissed, readGoalId, readLayout, safeProjectFile, writeDismissed, writeGoalId, writeLayout } from './state-files';
import { TurnTracker } from './turns';
import { watchProject, type ProjectWatcher } from './watcher';

/** Changed paths remembered for attributing Bash edits to Claude. */
const MAX_RECENT_CHANGES = 5000;
/** Findings the Stop hook shows Claude at most. */
const MAX_STOP_FINDINGS = 5;
const DEFAULT_SOURCE_LINES = 40;
const MAX_SOURCE_LINES = 200;

export { toProjectRel } from '../project-path';

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
  /** Folder with the built map view. Undefined looks for it; null serves none. */
  uiDir?: string | null;
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

export async function startDaemon(rootArg: string, options: DaemonOptions = {}): Promise<DaemonHandle> {
  const root = canonicalRoot(rootArg);
  const log = options.log ?? (() => {});
  const idleMs = options.idleMs ?? 30 * 60_000;
  ensureMapskillDir(root);
  if (ensureGitignore(root)) log('added .mapskill/ to .gitignore');

  const token = randomBytes(24).toString('hex');
  const turns = new TurnTracker();
  const requestQueue = new RequestQueue(root);
  const timers: ReturnType<typeof setInterval>[] = [];
  /** Recently changed project paths with the time they were applied, oldest first. */
  const recentChanges: { path: string; at: number }[] = [];
  let project: Project | undefined;
  let goalId: string | null = null;
  let goalStatus: GoalStatus | null = null;
  /** Set once startServer has returned: until then there is nothing to broadcast to. */
  let serverReady = false;
  let seq = 0;
  let lastActivity = Date.now();
  let changedSinceReconcile = false;
  let watcher: ProjectWatcher | undefined;
  let cacheTimer: ReturnType<typeof setTimeout> | undefined;
  let stopping: Promise<void> | undefined;
  /** Set synchronously at the start of stop(), before the final drain (which runs before `stopping` is assigned). */
  let closing = false;
  let watcherRestart: Promise<void> | undefined;
  let restartAgain = false;
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
    if (cacheTimer || stopping) return;
    cacheTimer = setTimeout(() => {
      cacheTimer = undefined;
      saveCache();
    }, options.cacheSaveMs ?? 5000);
  };

  // Note: stop() drains the queue before `stopping` is assigned (its body runs synchronously up to the first await).
  const onFlush = (batch: ChangeBatch): void => {
    if (!project || stopping) return;
    const known = new Set([...Object.keys(project.facts), ...project.skipped]);
    try {
      const result = applyFileChanges(project, batch.paths);
      const current = result.project;
      project = current;
      changedSinceReconcile = true;
      // A new .gitignore changes which folders the watcher must skip.
      if (result.reloaded && batch.paths.includes('.gitignore')) restartWatcher();
      // The goal status is computed before the delta goes out, so a change caused by it travels in the same message.
      const goalChange = recomputeGoal();
      if (!result.empty) {
        seq += 1;
        server.broadcast(goalChange ? { type: 'delta', seq, delta: result.delta, goal: goalChange.status } : { type: 'delta', seq, delta: result.delta });
        scheduleCacheSave();
      } else if (goalChange) {
        server.broadcast({ type: 'goal', status: goalChange.status });
      }
      const relevant = batch.paths.filter((p) => known.has(p) || p in current.facts || current.skipped.has(p));
      const at = Date.now();
      for (const p of relevant) recentChanges.push({ path: p, at });
      if (recentChanges.length > MAX_RECENT_CHANGES) recentChanges.splice(0, recentChanges.length - MAX_RECENT_CHANGES);
      if (relevant.length > 0) {
        const claude = new Set(batch.byClaude);
        server.broadcast({
          type: 'activity',
          at: Date.now(),
          files: relevant.map((p) => ({ path: p, by: claude.has(p) ? 'claude' : 'watcher' })),
        });
      }
    } catch (err) {
      changedSinceReconcile = true; // let the drift check recover a failed batch
      log(`update failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      refreshGoal();
    }
  };
  const goalFileExists = (rel: string): boolean => {
    const abs = safeProjectFile(root, rel);
    return abs !== null && fs.existsSync(abs);
  };
  /** A broken template (for example an extends cycle) must never take the daemon down: it counts as no goal. */
  const safeFindGoal = (id: string): ReturnType<typeof findGoal> => {
    try {
      return findGoal(id);
    } catch (err) {
      log(`goal ${id} is unusable: ${String(err)}`);
      return null;
    }
  };
  /** Recomputes the goal status and stores it. Returns the new status when it changed, otherwise null. Does not broadcast. */
  const recomputeGoal = (): { status: GoalStatus | null } | null => {
    if (!project || !serverReady) return null;
    let next: GoalStatus | null = null;
    try {
      const template = goalId ? safeFindGoal(goalId) : null;
      next = template ? evaluateGoal(template, toPublicGraph(project.graph), goalFileExists) : null;
    } catch (err) {
      // Keep what clients already show rather than reporting "no goal".
      log(`goal evaluation failed: ${String(err)}`);
      return null;
    }
    if (JSON.stringify(next) === JSON.stringify(goalStatus)) return null;
    goalStatus = next;
    return { status: goalStatus };
  };
  /** Recomputes the goal status; pushes it on its own when it changed. */
  const refreshGoal = (): void => {
    const change = recomputeGoal();
    if (change) server.broadcast({ type: 'goal', status: change.status });
  };
  const queue = new ChangeQueue(onFlush, options.debounceMs ?? 200);

  const loaded = (async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (stopping) return;
    const started = Date.now();
    project = loadProject(root, readFactsCache(root), readDismissed(root));
    saveCache();
    log(`loaded ${Object.keys(project.facts).length} files in ${Date.now() - started} ms`);
    const saved = readGoalId(root);
    if (saved !== null && !safeFindGoal(saved)) log(`unknown goal in goal.yaml: ${saved}`);
    else goalId = saved;
    refreshGoal();
  })();
  loaded.catch(() => {}); // `ready` reports load failures; this avoids an unhandled rejection if startServer fails first
  const currentFindingIds = (): string[] => project?.graph.findings.map((f) => f.id) ?? [];
  const graphNow = async (): Promise<PublicGraph> => {
    await loaded;
    queue.flushNow();
    return toPublicGraph(project!.graph);
  };
  const locksAnswer = (): LocksAnswer => {
    const read = readLocks(root);
    if (!read.ok) {
      log(`locks.json unreadable: ${read.error}`);
      return { locks: [], lockedFiles: [] };
    }
    const lockedFiles = Object.keys(project?.facts ?? {}).filter((f) => findLock(read.locks, f)).sort();
    return { locks: read.locks, lockedFiles };
  };
  const pushRequests = (): void => server.broadcast({ type: 'requests', requests: requestQueue.list() });

  const server = await startServer({
    token,
    uiDir: options.uiDir === undefined ? findUiDir() : options.uiDir,
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
    // No missed delta: there is no await between this graph snapshot and the server's clients.add (only microtasks),
    // and deltas are broadcast only from macrotasks. Adding an await here would break that guarantee.
    hello: async () => {
      const graph = await graphNow();
      refreshGoal(); // sync: nothing can slip in between this snapshot and the server adding the client
      return { type: 'graph', seq, graph, goal: goalStatus };
    },
    touched: async ({ files, sessionId, bash }) => {
      await loaded;
      if (stopping) return;
      const session = sessionId ?? 'default';
      const rels = files.map((f) => toProjectRel(root, f)).filter((r): r is string => r !== null);
      // Start the turn (and take its baseline) before anything from this tool use is applied.
      const turnId = turns.touch(session, rels, currentFindingIds());
      for (const rel of rels) queue.add(rel, 'claude');
      const since = turns.markReported(turnId, Date.now());
      if (!bash) return;
      // A Bash command gives no file list: apply what changed on disk now and attribute it to Claude.
      queue.flushNow();
      try {
        for (const rel of findDrift(project!)) queue.add(rel, 'claude');
      } catch (err) {
        log(`drift check failed: ${String(err)}`);
      }
      queue.flushNow();
      const changed = [...new Set(recentChanges.filter((c) => c.at >= since).map((c) => c.path))];
      if (changed.length > 0) turns.touch(session, changed, currentFindingIds());
    },
    startTurn: async (sessionId) => {
      await loaded;
      queue.flushNow();
      const turnId = turns.startTurn(sessionId, currentFindingIds());
      server.broadcast({ type: 'turn', at: Date.now(), sessionId });
      return turnId;
    },
    findings: async ({ since, session, ...query }) => {
      await loaded;
      queue.flushNow();
      const sessionId = session === 'latest' ? turns.latestSession() : session;
      const turnId = since ?? (sessionId === undefined ? undefined : turns.currentTurn(sessionId));
      if (turnId === undefined || !turns.hasTurn(turnId)) return { findings: [], turnId, unknownTurn: true };
      return { findings: turns.newFindings(turnId, project!.graph.findings, query), turnId, unknownTurn: false };
    },
    stopCheck: async (sessionId): Promise<StopAnswer> => {
      await loaded;
      queue.flushNow();
      const turnId = turns.currentTurn(sessionId);
      if (turnId === undefined) return { unknownTurn: true, alreadyReported: false, total: 0, findings: [] };
      const found = turns.newFindings(turnId, project!.graph.findings, { touchedOnly: true, certainty: 'certain' });
      if (found.length === 0) return { turnId, unknownTurn: false, alreadyReported: false, total: 0, findings: [] };
      if (!turns.claimStop(turnId)) return { turnId, unknownTurn: false, alreadyReported: true, total: found.length, findings: [] };
      return { turnId, unknownTurn: false, alreadyReported: false, total: found.length, findings: found.slice(0, MAX_STOP_FINDINGS) };
    },
    overview: async (maxNodes) => mapOverview(await graphNow(), { maxNodes }),
    similar: async (query) => {
      await loaded;
      queue.flushNow();
      return findSimilar(project!.graph.files, project!.graph.nodes, query);
    },
    node: async (query) => {
      if (query.path === undefined) return nodeDetails(await graphNow(), query);
      const rel = toProjectRel(root, query.path);
      return rel === null ? null : nodeDetails(await graphNow(), { ...query, path: rel });
    },
    locks: async () => {
      await loaded;
      return locksAnswer();
    },
    setLock: async (nodeId, locked) => {
      await loaded;
      queue.flushNow();
      const node = project!.graph.nodes.find((n) => n.id === nodeId);
      if (!node) throw new HttpError(404, 'no such part');
      if (!node.file) throw new HttpError(400, 'this part has no file to lock');
      const abs = path.join(root, node.file);
      if (locked) addLocks(root, [abs], path.basename(node.file));
      else removeLocks(root, [abs]);
      const answer = locksAnswer();
      server.broadcast({ type: 'locks', ...answer });
      if (!locked && answer.lockedFiles.includes(node.file)) {
        const read = readLocks(root);
        const via = read.ok ? findLock(read.locks, node.file)?.path : undefined;
        throw new HttpError(409, `still locked through ${via ?? 'another lock'}`);
      }
      return answer;
    },
    requests: async () => requestQueue.list(),
    addRequest: async (input) => {
      const r = requestQueue.add(input);
      pushRequests();
      return r;
    },
    cancelRequest: async (id) => {
      if (requestQueue.cancel(id)) pushRequests();
      return requestQueue.list();
    },
    claimRequests: async () => {
      const claimed = requestQueue.claimPending();
      if (claimed.length > 0) pushRequests();
      return claimed;
    },
    dismiss: async (findingId) => {
      await loaded;
      queue.flushNow();
      const finding = project!.graph.findings.find((f) => f.id === findingId);
      if (!finding) throw new HttpError(404, 'no such finding');
      const next = { ...project!.dismissed, [finding.id]: findingCodeHash(finding, project!.facts) };
      const result = setDismissed(project!, next);
      project = result.project;
      // Entries whose finding is visible again belong to code that has changed since: forget them.
      const visible = new Set(project.graph.findings.map((f) => f.id));
      const kept = Object.fromEntries(Object.entries(project.dismissed).filter(([id]) => !visible.has(id)));
      project.dismissed = kept;
      // The goal travels with the delta, so clients apply both in one step; on its own only when the delta is empty.
      const goalChange = recomputeGoal();
      // Broadcast first: the graph already changed, so clients must not miss the delta if the write fails.
      if (!result.empty) {
        seq += 1;
        server.broadcast(goalChange ? { type: 'delta', seq, delta: result.delta, goal: goalChange.status } : { type: 'delta', seq, delta: result.delta });
      } else if (goalChange) {
        server.broadcast({ type: 'goal', status: goalChange.status });
      }
      try {
        writeDismissed(root, kept);
      } catch (err) {
        log(`dismissed.json write failed: ${String(err)}`);
      }
    },
    goal: async () => {
      await loaded;
      queue.flushNow();
      refreshGoal();
      return { goals: goalSummaries(), status: goalStatus };
    },
    setGoal: async (id) => {
      await loaded;
      if (id !== null && !safeFindGoal(id)) throw new HttpError(404, 'no such goal');
      writeGoalId(root, id);
      goalId = id;
      refreshGoal();
      return { goals: goalSummaries(), status: goalStatus };
    },
    layout: async () => readLayout(root),
    saveLayout: async (slots) => writeLayout(root, { version: 1, slots: mergeLayout(readLayout(root).slots, slots) }),
    source: async (file, start = 1, end): Promise<SourceAnswer | null> => {
      await loaded;
      const rel = toProjectRel(root, file);
      if (rel === null || !Object.hasOwn(project!.facts, rel) || /^\.env/.test(rel.split('/').pop()!)) return null;
      let text: string;
      try {
        text = fs.readFileSync(path.join(root, rel), 'utf8');
      } catch {
        return null;
      }
      const all = text.split('\n').map((l) => l.replace(/\r$/, ''));
      const total = all.length;
      if (start > total) return { file: rel, start: total + 1, end: total, total, lines: [] };
      const wanted = Math.max(start, end ?? start + DEFAULT_SOURCE_LINES - 1);
      const last = Math.min(wanted, start + MAX_SOURCE_LINES - 1, total);
      return { file: rel, start, end: last, total, lines: all.slice(start - 1, last) };
    },
    shutdown: () => {
      void stop('shutdown request');
    },
    activity: () => {
      lastActivity = Date.now();
    },
  });

  serverReady = true;
  refreshGoal();

  const info: DaemonInfo = { pid: process.pid, port: server.port, token, version: DAEMON_VERSION, root, startedAt: Date.now() };
  writeDaemonInfo(root, info);

  /** Starts the watcher, then queues whatever changed while no watcher was running. */
  const openWatcher = async (): Promise<void> => {
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
    if (closing) {
      await w.close();
      return;
    }
    watcher = w;
    for (const rel of findDrift(project!)) queue.add(rel, 'watcher');
  };
  /**
   * Replaces the watcher so it reads the new .gitignore. Fire and forget: errors are logged, onFlush is not blocked.
   * Waits for the first watcher, runs one restart at a time, and stops early once the daemon is stopping.
   */
  const restartWatcher = (): void => {
    if (options.watch === false || closing) return;
    if (watcherRestart) {
      restartAgain = true; // .gitignore changed again while restarting: restart once more afterwards
      return;
    }
    watcherRestart = (async () => {
      await ready.catch(() => {});
      do {
        restartAgain = false;
        try {
          const old = watcher;
          watcher = undefined;
          await old?.close();
          if (closing) return;
          await openWatcher();
        } catch (err) {
          log(`watcher restart failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        }
      } while (restartAgain && !closing);
    })().finally(() => {
      watcherRestart = undefined;
    });
  };

  const ready = loaded.then(async () => {
    if (options.watch === false || stopping) return;
    await openWatcher();
  });
  ready.catch((err: unknown) => {
    log(`start failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    void stop('start failed');
  });

  timers.push(
    setInterval(() => {
      if (!project || !changedSinceReconcile || stopping) return;
      changedSinceReconcile = false;
      try {
        for (const rel of findDrift(project)) queue.add(rel, 'watcher');
      } catch (err) {
        changedSinceReconcile = true; // retry on the next tick
        log(`drift check failed: ${String(err)}`);
      }
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
    closing = true;
    stopping = (async () => {
      // Each step is guarded on its own, so one failure does not skip the rest.
      const step = async (name: string, fn: () => unknown): Promise<void> => {
        try {
          await fn();
        } catch (err) {
          log(`${name} failed: ${String(err)}`);
        }
      };
      try {
        log(`stopping: ${reason}`);
        for (const t of timers) clearInterval(t);
        await step('final drain', () => {
          queue.flushNow();
          queue.dispose();
        });
        // The final drain can re-arm the cache timer; the explicit saveCache below replaces it.
        if (cacheTimer) clearTimeout(cacheTimer);
        cacheTimer = undefined;
        await step('watcher close', async () => {
          await watcherRestart; // never rejects; it sees `stopping` and closes what it opened
          await watcher?.close();
        });
        await step('server close', () => server.close());
        await step('cache save', () => saveCache());
        await step('daemon.json removal', () => removeDaemonInfo(root, process.pid));
      } finally {
        resolveDone(reason);
      }
    })();
    return stopping;
  }

  return { info, ready, done, stop, project: () => project };
}
