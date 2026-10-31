import type { PublicGraph } from '@mapskill/core';
import type { ServerDeps } from './server';

export const TOKEN = 'secret-token';
export const emptyGraph: PublicGraph = {
  root: '/p', framework: 'nextjs', nodes: [], edges: [], findings: [], health: {}, fileCount: 0, unreadableFiles: [],
};

export function fakeDeps(over: Partial<ServerDeps> = {}) {
  const calls = {
    touched: [] as unknown[],
    findings: [] as unknown[],
    shutdown: 0,
    activity: 0,
    stop: [] as unknown[],
    setLock: [] as unknown[],
    addRequest: [] as unknown[],
    cancelRequest: [] as unknown[],
    claimRequests: [] as unknown[],
    dismiss: [] as unknown[],
    saveLayout: [] as unknown[],
    source: [] as unknown[],
  };
  const deps: ServerDeps = {
    token: TOKEN,
    uiDir: null,
    status: () => ({ ok: true, root: '/p', pid: process.pid, version: 'test', ready: true, fileCount: 0, clients: 0, seq: 0 }),
    graph: async () => emptyGraph,
    hello: async () => ({ type: 'graph', seq: 0, graph: emptyGraph }),
    touched: async (input) => {
      calls.touched.push(input);
    },
    startTurn: async () => 'turn-1',
    findings: async (query) => {
      calls.findings.push(query);
      const turnId = query.since ?? (query.session === 's1' ? 'turn-1' : undefined);
      return { findings: [], turnId, unknownTurn: turnId !== 'turn-1' };
    },
    stopCheck: async (sessionId) => {
      calls.stop.push(sessionId);
      return { turnId: 'turn-1', unknownTurn: false, alreadyReported: false, total: 0, findings: [] };
    },
    overview: async (maxNodes) => `overview ${maxNodes ?? 'default'}`,
    similar: async (q) => [{ name: q.name ?? 'x', file: 'lib/a.ts', startLine: 1, endLine: 2, score: 0.9, reason: 'similar-name' }],
    node: async (q) => (q.id === 'known' || q.path === 'lib/a.ts' ? 'details' : null),
    locks: async () => ({ locks: [], lockedFiles: [] }),
    setLock: async (nodeId, locked) => {
      calls.setLock.push([nodeId, locked]);
      return { locks: [], lockedFiles: [] };
    },
    requests: async () => [],
    addRequest: async (input) => {
      calls.addRequest.push(input);
      return { id: 'r1', kind: input.kind, text: input.text, createdAt: 1, status: 'pending' };
    },
    cancelRequest: async (id) => {
      calls.cancelRequest.push(id);
      return [];
    },
    claimRequests: async (sessionId) => {
      calls.claimRequests.push(sessionId);
      return [];
    },
    dismiss: async (findingId) => {
      calls.dismiss.push(findingId);
    },
    layout: async () => ({ version: 1, slots: {} }),
    saveLayout: async (slots) => {
      calls.saveLayout.push(slots);
    },
    source: async (file, start, end) => {
      calls.source.push([file, start, end]);
      return file === 'lib/a.ts' ? { file, start: start ?? 1, end: end ?? 40, total: 3, lines: ['a', 'b'] } : null;
    },
    shutdown: () => {
      calls.shutdown++;
    },
    activity: () => {
      calls.activity++;
    },
    ...over,
  };
  return { deps, calls };
}

export const fakeServerDeps = (): ServerDeps => fakeDeps().deps;
