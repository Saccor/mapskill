import fs from 'node:fs';
import path from 'node:path';
import type { DaemonStatus, Finding, PublicGraph } from '@mapskill/core';
import { generateProject, tmpProject } from '@mapskill/core/test-helpers';
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

const handles: DaemonHandle[] = [];
afterEach(async () => {
  drift.fail = false;
  drift.calls = 0;
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
});
