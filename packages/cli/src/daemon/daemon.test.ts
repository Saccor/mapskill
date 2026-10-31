import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DaemonStatus, Finding, PublicGraph } from '@mapskill/core';
import { fixture, generateProject, tmpProject } from '@mapskill/core/test-helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connect, waitFor } from '../test-utils';
import { readFactsCache } from './cache';
import { request } from './client';
import { startDaemon, toProjectRel, type DaemonHandle, type DaemonOptions } from './daemon';
import { readDaemonInfo } from './info';

const drift = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock('@mapskill/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mapskill/core')>();
  return {
    ...actual,
    findDrift: (...args: Parameters<typeof actual.findDrift>) => {
      drift.calls += 1;
      if (drift.fail) throw new Error('ENOENT: folder vanished mid-walk');
      return actual.findDrift(...args);
    },
  };
});

const serverClose = vi.hoisted(() => ({ fail: false }));
vi.mock('./server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./server')>();
  return {
    ...actual,
    startServer: async (...args: Parameters<typeof actual.startServer>) => {
      const server = await actual.startServer(...args);
      return {
        ...server,
        // DaemonServer is a plain object (port + methods), so spreading it keeps everything.
        close: async () => {
          await server.close();
          if (serverClose.fail) throw new Error('close exploded');
        },
      };
    },
  };
});

const fn = (name: string): string =>
  `export function ${name}(items: number[]) {\n` +
  `  const total = items.reduce((a, b) => a + b, 0);\n` +
  `  const avg = total / Math.max(items.length, 1);\n` +
  `  const big = items.filter((x) => x > avg);\n` +
  `  const small = items.filter((x) => x <= avg);\n` +
  `  console.log(big, small);\n` +
  `  return total;\n` +
  `}\n`;
const files = (): Record<string, string> => ({
  'package.json': JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['./*'] } } }),
  'app/page.tsx': "import { sumA } from '@/lib/a';\nexport default function Page() {\n  return <p>{sumA([1])}</p>;\n}\n",
  'lib/a.ts': fn('sumA'),
});
const write = (root: string, rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

const copyFixture = (name: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mapskill-${name}-`));
  fs.cpSync(fixture(name), dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('.mapskill') });
  return dir;
};

const handles: DaemonHandle[] = [];
afterEach(async () => {
  drift.fail = false;
  drift.calls = 0;
  serverClose.fail = false;
  await Promise.all(handles.splice(0).map((h) => h.stop('test done')));
});
async function start(root: string, options: DaemonOptions = {}): Promise<DaemonHandle> {
  const handle = await startDaemon(root, options);
  handles.push(handle);
  return handle;
}

describe('startDaemon', () => {
  it('serves the graph and writes daemon.json', async () => {
    const root = tmpProject(files());
    const h = await start(root);
    expect(readDaemonInfo(root)).toEqual(h.info);
    const graph = await request<PublicGraph>(h.info, 'GET', '/api/graph');
    expect(graph.nodes.some((n) => n.file === 'lib/a.ts')).toBe(true);
    expect(await request<DaemonStatus>(h.info, 'GET', '/api/status')).toMatchObject({ ready: true, fileCount: 2 });
  });

  it('pushes a delta and an activity event when a file changes on disk', async () => {
    const root = tmpProject(files());
    const h = await start(root);
    await h.ready;
    const client = await connect(h.info);
    write(root, 'lib/b.ts', fn('sumB'));
    await waitFor(() => client.messages.some((m) => m.type === 'delta'), 10_000);
    const delta = client.messages.find((m) => m.type === 'delta');
    expect(delta?.type === 'delta' && delta.seq === 1 && delta.delta.addedNodes.some((n) => n.file === 'lib/b.ts')).toBe(true);
    await waitFor(() => client.messages.some((m) => m.type === 'activity'));
    client.close();
  });

  it('reports new findings for files Claude touched during a turn', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    const { turnId } = await request<{ turnId: string }>(h.info, 'POST', '/api/turn', { sessionId: 's1' });
    write(root, 'lib/b.ts', fn('sumB'));
    await request(h.info, 'POST', '/api/touched', { files: [path.join(root, 'lib/b.ts')], sessionId: 's1', toolUseId: 'tu1' });
    const { findings } = await request<{ findings: Finding[] }>(
      h.info, 'GET', `/api/findings?since=${turnId}&touchedOnly=true&certainty=certain`,
    );
    expect(findings.some((f) => f.kind.endsWith('-duplicate') && f.files.includes('lib/b.ts'))).toBe(true);
    const other = await request<{ turnId: string }>(h.info, 'POST', '/api/turn', { sessionId: 's2' });
    const none = await request<{ findings: Finding[] }>(h.info, 'GET', `/api/findings?since=${other.turnId}&touchedOnly=true`);
    expect(none.findings).toEqual([]);
  });

  it('answers findings by session (the Stop hook contract) and flags unknown turns', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    const { turnId } = await request<{ turnId: string }>(h.info, 'POST', '/api/turn', { sessionId: 's1' });
    write(root, 'lib/b.ts', fn('sumB'));
    await request(h.info, 'POST', '/api/touched', { files: [path.join(root, 'lib/b.ts')], sessionId: 's1' });
    type Answer = { findings: Finding[]; turnId?: string; unknownTurn: boolean };
    const bySession = await request<Answer>(h.info, 'GET', '/api/findings?session=s1&touchedOnly=true&certainty=certain');
    expect(bySession.turnId).toBe(turnId);
    expect(bySession.unknownTurn).toBe(false);
    expect(bySession.findings.some((f) => f.kind.endsWith('-duplicate') && f.files.includes('lib/b.ts'))).toBe(true);
    expect(await request<Answer>(h.info, 'GET', '/api/findings?session=never-seen')).toEqual({ findings: [], unknownTurn: true });
    expect(await request<Answer>(h.info, 'GET', '/api/findings?since=no-such-turn')).toEqual({
      findings: [],
      turnId: 'no-such-turn',
      unknownTurn: true,
    });
  });

  it('removes the nodes of a deleted folder', async () => {
    const root = tmpProject({ ...files(), 'lib/b.ts': fn('sumB') });
    const h = await start(root);
    await h.ready;
    const client = await connect(h.info);
    fs.rmSync(path.join(root, 'lib'), { recursive: true });
    // Wait for what the client sees, not for the project: the project is updated before the delta is broadcast.
    await waitFor(
      () => client.messages.some((m) => m.type === 'delta' && m.delta.removedNodeIds.some((id) => id.includes('lib/b.ts'))),
      10_000,
    );
    // The watcher may report lib/a.ts in a later batch than lib/b.ts, so allow one more debounce round.
    await waitFor(() => {
      const g = h.project()?.graph;
      return g !== undefined && !Object.keys(g.files).some((f) => f.startsWith('lib/'));
    }, 5000);
    client.close();
  });

  it('restarts the watcher when .gitignore changes', async () => {
    const root = tmpProject({ ...files(), '.gitignore': '.mapskill/*\ngen/\n', 'gen/old.ts': 'export const old = 1;\n' });
    const h = await start(root);
    await h.ready;
    const client = await connect(h.info);
    fs.writeFileSync(path.join(root, '.gitignore'), '.mapskill/*\n');
    await waitFor(() => h.project()?.facts['gen/old.ts'] !== undefined, 10_000); // reload picked up gen/
    write(root, 'gen/new.ts', fn('sumNew'));
    await waitFor(
      () => client.messages.some((m) => m.type === 'delta' && m.delta.addedNodes.some((n) => n.file === 'gen/new.ts')),
      10_000,
    );
    client.close();
  }, 30_000);

  it('adds .mapskill/ to an existing .gitignore', async () => {
    const root = tmpProject({ ...files(), '.gitignore': 'node_modules\n' });
    await start(root, { watch: false });
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('.mapskill/*');
  });

  it('stops by itself when idle and cleans up', async () => {
    const root = tmpProject(files());
    const h = await startDaemon(root, { idleMs: 300, watch: false });
    await expect(h.done).resolves.toBe('idle');
    expect(readDaemonInfo(root)).toBeNull();
    expect(Object.keys(readFactsCache(root))).toContain('lib/a.ts');
  }, 10_000);

  it('stops when another daemon took over daemon.json', async () => {
    const root = tmpProject(files());
    const h = await startDaemon(root, { idleMs: 400, watch: false });
    fs.writeFileSync(path.join(root, '.mapskill', 'daemon.json'), JSON.stringify({ ...h.info, pid: h.info.pid + 1 }));
    await expect(h.done).resolves.toBe('replaced by another daemon');
  }, 10_000);

  it('meets the 2-second budget on a 500-file project', async () => {
    const root = generateProject(500);
    const h = await start(root);
    await h.ready;
    const client = await connect(h.info);
    const started = performance.now();
    fs.appendFileSync(path.join(root, 'lib/h3.ts'), '\nexport const extra = 1;\n');
    await waitFor(() => client.messages.some((m) => m.type === 'delta'), 5000, 10);
    expect(performance.now() - started).toBeLessThan(2000);
    client.close();
  }, 60_000);

  it('blocks the stop once per turn and only for certain findings in touched files', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    type Stop = { turnId?: string; unknownTurn: boolean; alreadyReported: boolean; total: number; findings: Finding[] };
    expect(await request<Stop>(h.info, 'POST', '/api/stop', { sessionId: 's1' })).toMatchObject({ unknownTurn: true, total: 0 });
    await request(h.info, 'POST', '/api/turn', { sessionId: 's1' });
    expect(await request<Stop>(h.info, 'POST', '/api/stop', { sessionId: 's1' })).toMatchObject({ unknownTurn: false, total: 0 });
    write(root, 'lib/b.ts', fn('sumB'));
    await request(h.info, 'POST', '/api/touched', { files: [path.join(root, 'lib/b.ts')], sessionId: 's1' });
    const first = await request<Stop>(h.info, 'POST', '/api/stop', { sessionId: 's1' });
    expect(first.alreadyReported).toBe(false);
    expect(first.total).toBeGreaterThan(0);
    expect(first.findings.every((f) => f.certainty === 'certain' && f.files.includes('lib/b.ts'))).toBe(true);
    const second = await request<Stop>(h.info, 'POST', '/api/stop', { sessionId: 's1' });
    expect(second).toMatchObject({ alreadyReported: true, findings: [] });
    await request(h.info, 'POST', '/api/turn', { sessionId: 's1' });
    expect(await request<Stop>(h.info, 'POST', '/api/stop', { sessionId: 's1' })).toMatchObject({ total: 0 });
  });

  it('counts files changed by a Bash command as touched by Claude', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    await request(h.info, 'POST', '/api/turn', { sessionId: 's1' });
    write(root, 'lib/c.ts', fn('sumC')); // as if `cp lib/a.ts lib/c.ts` ran in Bash: no file list from the hook
    await request(h.info, 'POST', '/api/touched', { files: [], sessionId: 's1', bash: true });
    const stop = await request<{ findings: Finding[] }>(h.info, 'POST', '/api/stop', { sessionId: 's1' });
    expect(stop.findings.some((f) => f.kind.endsWith('-duplicate') && f.files.includes('lib/c.ts'))).toBe(true);
  });

  it('answers findings for the latest session', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    await request(h.info, 'POST', '/api/turn', { sessionId: 'old' });
    const { turnId } = await request<{ turnId: string }>(h.info, 'POST', '/api/turn', { sessionId: 'new' });
    const answer = await request<{ turnId?: string }>(h.info, 'GET', '/api/findings?session=latest');
    expect(answer.turnId).toBe(turnId);
  });

  it('serves the overview, similar functions and node details', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    const { text } = await request<{ text: string }>(h.info, 'GET', '/api/overview');
    expect(text).toContain('sumA [helper]');
    const { matches } = await request<{ matches: { name: string; file: string }[] }>(h.info, 'POST', '/api/similar', { code: fn('other') });
    expect(matches[0]).toMatchObject({ name: 'sumA', file: 'lib/a.ts' });
    const node = await request<{ text: string }>(h.info, 'GET', '/api/node?path=lib/a.ts');
    expect(node.text).toContain('sumA');
    const abs = await request<{ text: string }>(h.info, 'GET', `/api/node?path=${encodeURIComponent(path.join(root, 'lib', 'a.ts'))}`);
    expect(abs.text).toContain('sumA');
    await expect(request(h.info, 'GET', `/api/node?path=${encodeURIComponent(path.join(root, '..', 'x.ts'))}`)).rejects.toThrow(/404|no such node/);
  });

  it('locks a part from the map and reports the locked files', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    const client = await connect(h.info);
    type Locks = { locks: { path: string; label?: string }[]; lockedFiles: string[] };
    const graph = await request<PublicGraph>(h.info, 'GET', '/api/graph');
    const node = graph.nodes.find((n) => n.file === 'lib/a.ts')!;
    const locked = await request<Locks>(h.info, 'POST', '/api/locks', { nodeId: node.id, locked: true });
    expect(locked.lockedFiles).toEqual(['lib/a.ts']);
    expect(locked.locks[0]).toMatchObject({ path: 'lib/a.ts', label: 'a.ts' });
    await waitFor(() => client.messages.some((m) => m.type === 'locks'));
    const unlocked = await request<Locks>(h.info, 'POST', '/api/locks', { nodeId: node.id, locked: false });
    expect(unlocked.lockedFiles).toEqual([]);
    const table = graph.nodes.find((n) => !n.file);
    if (table) await expect(request(h.info, 'POST', '/api/locks', { nodeId: table.id, locked: true })).rejects.toMatchObject({ status: 400 });
    await expect(request(h.info, 'POST', '/api/locks', { nodeId: 'nope', locked: true })).rejects.toMatchObject({ status: 404 });
    client.close();
  });

  it('queues map requests, pushes them and hands them out once', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    const client = await connect(h.info);
    const { request: r } = await request<{ request: { id: string } }>(h.info, 'POST', '/api/requests', { kind: 'explain', text: 'Explain sumA' });
    await waitFor(() => client.messages.some((m) => m.type === 'requests' && m.requests.length === 1));
    const claimed = await request<{ requests: { id: string }[] }>(h.info, 'POST', '/api/requests/claim', { sessionId: 's1' });
    expect(claimed.requests.map((x) => x.id)).toEqual([r.id]);
    expect((await request<{ requests: unknown[] }>(h.info, 'POST', '/api/requests/claim', {})).requests).toEqual([]);
    expect(fs.existsSync(path.join(root, '.mapskill', 'requests.json'))).toBe(true);
    client.close();
  });

  it('dismisses a finding, pushes a delta and remembers it across restarts', async () => {
    const root = tmpProject({ ...files(), 'lib/b.ts': fn('sumB') });
    const h = await start(root, { watch: false });
    const client = await connect(h.info);
    const graph = await request<PublicGraph>(h.info, 'GET', '/api/graph');
    const dup = graph.findings.find((f) => f.kind.endsWith('-duplicate'))!;
    await request(h.info, 'POST', '/api/dismiss', { findingId: dup.id });
    await waitFor(() => client.messages.some((m) => m.type === 'delta' && m.delta.resolvedFindingIds.includes(dup.id)));
    await expect(request(h.info, 'POST', '/api/dismiss', { findingId: dup.id })).rejects.toMatchObject({ status: 404 });
    client.close();
    await h.stop('restart');
    const h2 = await start(root, { watch: false });
    const again = await request<PublicGraph>(h2.info, 'GET', '/api/graph');
    expect(again.findings.some((f) => f.id === dup.id)).toBe(false);
  });

  it('saves the layout and serves source lines of project files only', async () => {
    const root = tmpProject({ ...files(), '.env': 'SECRET=1\n' });
    const h = await start(root, { watch: false });
    await request(h.info, 'POST', '/api/layout', { slots: { 'helper:lib/a.ts#sumA': 4 } });
    expect(await request(h.info, 'GET', '/api/layout')).toEqual({ version: 1, slots: { 'helper:lib/a.ts#sumA': 4 } });
    await request(h.info, 'POST', '/api/layout', { slots: { 'helper:lib/b.ts#sumB': 1 } });
    expect((await request<{ slots: Record<string, number> }>(h.info, 'GET', '/api/layout')).slots).toEqual({
      'helper:lib/a.ts#sumA': 4,
      'helper:lib/b.ts#sumB': 1,
    });
    const src = await request<{ file: string; start: number; end: number; total: number; lines: string[] }>(
      h.info, 'GET', '/api/source?file=lib/a.ts&start=2&end=3',
    );
    expect(src).toMatchObject({ file: 'lib/a.ts', start: 2, end: 3 });
    expect(src.lines).toHaveLength(2);
    expect(src.lines[0]).toContain('const total');
    const total = (await request<{ total: number }>(h.info, 'GET', '/api/source?file=lib/a.ts')).total;
    expect(await request(h.info, 'GET', `/api/source?file=lib/a.ts&start=${total + 50}&end=${total + 60}`)).toMatchObject({
      start: total + 1, end: total, total, lines: [],
    });
    const backwards = await request<{ start: number; end: number; lines: string[] }>(h.info, 'GET', '/api/source?file=lib/a.ts&start=3&end=1');
    expect(backwards).toMatchObject({ start: 3, end: 3 });
    expect(backwards.lines).toHaveLength(1);
    const abs = await request<{ file: string }>(h.info, 'GET', `/api/source?file=${encodeURIComponent(path.join(root, 'lib', 'a.ts'))}`);
    expect(abs.file).toBe('lib/a.ts');
    await expect(request(h.info, 'GET', '/api/source?file=.env')).rejects.toMatchObject({ status: 404 });
    await expect(request(h.info, 'GET', `/api/source?file=${encodeURIComponent('../outside.ts')}`)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses prototype names and .env* files as source', async () => {
    const root = tmpProject({ ...files(), constructor: 'x\n', toString: 'y\n', '.env.local.ts': 'export const k = 1;\n' });
    const h = await start(root, { watch: false });
    for (const f of ['constructor', 'toString', '__proto__', '.env.local.ts']) {
      await expect(request(h.info, 'GET', `/api/source?file=${encodeURIComponent(f)}`)).rejects.toMatchObject({ status: 404 });
    }
  });

  it('pushes a turn message when a turn starts', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    const client = await connect(h.info);
    await request(h.info, 'POST', '/api/turn', { sessionId: 's1' });
    await waitFor(() => client.messages.some((m) => m.type === 'turn' && m.sessionId === 's1'));
    client.close();
  });
});

describe('daemon lifecycle', () => {
  it('survives a failing drift check and retries it', async () => {
    const root = tmpProject(files());
    const lines: string[] = [];
    const h = await start(root, { watch: false, reconcileMs: 50, log: (l) => lines.push(l) });
    await h.ready;
    drift.fail = true;
    drift.calls = 0;
    write(root, 'lib/b.ts', fn('sumB'));
    await request(h.info, 'POST', '/api/touched', { files: [path.join(root, 'lib/b.ts')], sessionId: 's1' });
    await waitFor(() => lines.some((l) => l.includes('drift check failed')), 5000);
    const callsAfterFailure = drift.calls;
    await waitFor(() => drift.calls > callsAfterFailure, 5000);
    drift.fail = false;
    expect(await request<DaemonStatus>(h.info, 'GET', '/api/status')).toMatchObject({ ready: true });
  });

  it('stop() twice resolves the same way and done resolves once', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    await h.ready;
    const first = h.stop('first');
    const second = h.stop('second');
    await Promise.all([first, second]);
    await expect(h.done).resolves.toBe('first');
    expect(readDaemonInfo(root)).toBeNull();
  });

  it('stop() drains pending changes without re-arming the cache timer', async () => {
    const root = tmpProject(files());
    // Small cacheSaveMs so a re-armed timer would fire (and rewrite cache.json) within the observation window.
    const h = await start(root, { watch: false, debounceMs: 60_000, cacheSaveMs: 100 });
    await h.ready;
    write(root, 'lib/b.ts', fn('sumB'));
    await request(h.info, 'POST', '/api/touched', { files: [path.join(root, 'lib/b.ts')], sessionId: 's1' });
    await h.stop('drain');
    await expect(h.done).resolves.toBe('drain');
    const cacheFile = path.join(root, '.mapskill', 'cache.json');
    expect(Object.keys(readFactsCache(root))).toContain('lib/b.ts');
    const before = fs.statSync(cacheFile).mtimeMs;
    await new Promise((r) => setTimeout(r, 300));
    expect(fs.statSync(cacheFile).mtimeMs).toBe(before);
  });

  it('stop() runs every teardown step even when one fails', async () => {
    const root = tmpProject(files());
    const lines: string[] = [];
    const h = await start(root, { watch: false, log: (l) => lines.push(l) });
    await h.ready;
    fs.rmSync(path.join(root, '.mapskill', 'cache.json'), { force: true });
    serverClose.fail = true;
    await h.stop('broken close');
    await expect(h.done).resolves.toBe('broken close');
    expect(lines.some((l) => l.includes('server close failed'))).toBe(true);
    expect(Object.keys(readFactsCache(root))).toContain('lib/a.ts'); // saveCache still ran
    expect(readDaemonInfo(root)).toBeNull(); // removeDaemonInfo still ran
  });

  it('stop() right after start skips loading and leaves no cache or daemon.json', async () => {
    const root = tmpProject(files());
    // Relies on startServer resolving before the load's setImmediate fires, so stop() wins the race with loading.
    const h = await startDaemon(root, { watch: false });
    await h.stop('early');
    await expect(h.done).resolves.toBe('early');
    await new Promise((r) => setTimeout(r, 300));
    expect(readDaemonInfo(root)).toBeNull();
    expect(Object.keys(readFactsCache(root))).toEqual([]);
    expect(h.project()).toBeUndefined();
  });
});

describe('toProjectRel', () => {
  it('turns absolute and relative paths into project paths', () => {
    const root = path.resolve('/proj');
    expect(toProjectRel(root, path.join(root, 'lib', 'a.ts'))).toBe('lib/a.ts');
    expect(toProjectRel(root, 'lib/a.ts')).toBe('lib/a.ts');
    expect(toProjectRel(root, path.resolve('/elsewhere/a.ts'))).toBeNull();
    expect(toProjectRel(root, root)).toBeNull();
  });

  it('maps an existing file and a deleted file under a real root', () => {
    const root = fs.realpathSync.native(tmpProject({ 'lib/a.ts': 'export const a = 1;\n', 'lib/gone.ts': '' }));
    fs.rmSync(path.join(root, 'lib/gone.ts'));
    expect(toProjectRel(root, path.join(root, 'lib', 'a.ts'))).toBe('lib/a.ts');
    expect(toProjectRel(root, 'lib/a.ts')).toBe('lib/a.ts');
    expect(toProjectRel(root, path.join(root, 'lib', 'gone.ts'))).toBe('lib/gone.ts');
    expect(toProjectRel(root, path.join(root, '..', 'outside.ts'))).toBeNull();
  });

  it.runIf(process.platform === 'win32')('maps a hook path with different letter case to the on-disk casing', () => {
    const root = fs.realpathSync.native(tmpProject({ 'lib/a.ts': 'export const a = 1;\n' }));
    expect(toProjectRel(root, 'LIB/A.TS')).toBe('lib/a.ts');
    expect(toProjectRel(root, path.join(root.toUpperCase(), 'LIB', 'A.TS'))).toBe('lib/a.ts');
  });
});

describe('startDaemon root', () => {
  it.runIf(process.platform === 'win32')('canonicalises the root letter case', async () => {
    const root = fs.realpathSync.native(tmpProject(files()));
    const h = await start(root.toUpperCase(), { watch: false });
    expect(h.info.root).toBe(root);
  });
});

describe('goals', () => {
  it('evaluates the chosen goal, pushes changes and remembers the choice', async () => {
    const root = copyFixture('half-saas');
    const h = await start(root, { watch: false });
    const client = await connect(h.info);
    type Answer = { goals: { id: string }[]; status: { goalId: string; done: number; total: number; items: { id: string; done: boolean }[] } | null };
    const first = await request<Answer>(h.info, 'GET', '/api/goal');
    expect(first.goals.map((g) => g.id)).toContain('saas-auth-payments');
    expect(first.status).toBeNull();

    const chosen = await request<Answer>(h.info, 'POST', '/api/goal', { goalId: 'saas-auth-payments' });
    expect(chosen.status!.items.filter((i) => !i.done).map((i) => i.id)).toEqual(['pricing-page', 'checkout', 'webhook', 'subscriptions-table']);
    await waitFor(() => client.messages.some((m) => m.type === 'goal' && m.status?.goalId === 'saas-auth-payments'));

    write(root, 'app/pricing/page.tsx', 'export default function Pricing() {\n  return <main>Prices</main>;\n}\n');
    await request(h.info, 'POST', '/api/touched', { files: [path.join(root, 'app/pricing/page.tsx')] });
    await request(h.info, 'GET', '/api/graph'); // flushes the queue
    await waitFor(() => client.messages.some((m) => m.type === 'goal' && m.status?.items.find((i) => i.id === 'pricing-page')?.done === true));

    await expect(request(h.info, 'POST', '/api/goal', { goalId: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(request(h.info, 'POST', '/api/goal', { goalId: 3 })).rejects.toMatchObject({ status: 400 });
    client.close();
    await h.stop('restart');
    const h2 = await start(root, { watch: false });
    expect((await request<Answer>(h2.info, 'GET', '/api/goal')).status?.goalId).toBe('saas-auth-payments');
    await request(h2.info, 'POST', '/api/goal', { goalId: null });
    expect(fs.existsSync(path.join(root, '.mapskill', 'goal.yaml'))).toBe(false);
  });

  it('counts a non-source file for fileExists checks and refuses paths outside the project', async () => {
    const root = copyFixture('half-saas');
    fs.rmSync(path.join(root, '.env.example'));
    const h = await start(root, { watch: false });
    type Answer = { status: { items: { id: string; done: boolean }[] } | null };
    const before = await request<Answer>(h.info, 'POST', '/api/goal', { goalId: 'webapp-auth' });
    expect(before.status!.items.find((i) => i.id === 'env-example')!.done).toBe(false);
    write(root, '.env.example', 'X=\n');
    await request(h.info, 'POST', '/api/touched', { files: [path.join(root, '.env.example')] });
    const after = await request<Answer>(h.info, 'GET', '/api/goal');
    expect(after.status!.items.find((i) => i.id === 'env-example')!.done).toBe(true);
  });

  it('treats an unknown goal in goal.yaml as no goal and logs it', async () => {
    const root = copyFixture('half-saas');
    write(root, '.mapskill/goal.yaml', 'goal: does-not-exist\n');
    const lines: string[] = [];
    const h = await start(root, { watch: false, log: (l) => lines.push(l) });
    const answer = await request<{ status: unknown }>(h.info, 'GET', '/api/goal');
    expect(answer.status).toBeNull();
    expect(lines.some((l) => l.includes('unknown goal in goal.yaml: does-not-exist'))).toBe(true);
  });

  it('queues build requests', async () => {
    const root = tmpProject(files());
    const h = await start(root, { watch: false });
    const { request: r } = await request<{ request: { kind: string } }>(h.info, 'POST', '/api/requests', { kind: 'build', text: 'Add a pricing page.' });
    expect(r.kind).toBe('build');
  });
});
