import http from 'node:http';
import net from 'node:net';
import type { PublicGraph } from '@mapskill/core';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { connect, waitFor } from '../test-utils';
import { DaemonRequestError, request } from './client';
import { HttpError, startServer, type DaemonServer, type ServerDeps } from './server';

const TOKEN = 'secret-token';
const emptyGraph: PublicGraph = {
  root: '/p', framework: 'nextjs', nodes: [], edges: [], findings: [], health: {}, fileCount: 0, unreadableFiles: [],
};

function fakeDeps(over: Partial<ServerDeps> = {}) {
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

function rawStatus(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/status', headers: { host, 'x-mapskill-token': TOKEN } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function closeCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.on('close', (code) => resolve(code)));
}

let server: DaemonServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('HTTP API', () => {
  it('rejects requests without the right token', async () => {
    server = await startServer(fakeDeps().deps);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/status`)).status).toBe(401);
    await expect(request({ port: server.port, token: 'wrong' }, 'GET', '/api/status')).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a foreign Host header', async () => {
    server = await startServer(fakeDeps().deps);
    expect(await rawStatus(server.port, 'evil.example')).toBe(403);
    expect(await rawStatus(server.port, `localhost:${server.port}`)).toBe(200);
  });

  it('answers status, turn and findings', async () => {
    const { deps, calls } = fakeDeps();
    server = await startServer(deps);
    const info = { port: server.port, token: TOKEN };
    expect(await request(info, 'GET', '/api/status')).toMatchObject({ ok: true, ready: true });
    expect(await request(info, 'GET', '/api/graph')).toEqual(emptyGraph);
    expect(await request(info, 'POST', '/api/turn', { sessionId: 's1' })).toEqual({ turnId: 'turn-1' });
    expect(await request(info, 'GET', '/api/findings?since=turn-1&touchedOnly=true&certainty=certain')).toEqual({
      findings: [],
      turnId: 'turn-1',
      unknownTurn: false,
    });
    expect(calls.findings).toEqual([{ since: 'turn-1', touchedOnly: true, certainty: 'certain' }]);
    expect(calls.activity).toBe(4); // one per authenticated request
  });

  it('answers findings for a session and flags unknown turns', async () => {
    const { deps, calls } = fakeDeps();
    server = await startServer(deps);
    const info = { port: server.port, token: TOKEN };
    expect(await request(info, 'GET', '/api/findings?session=s1')).toEqual({ findings: [], turnId: 'turn-1', unknownTurn: false });
    expect(await request(info, 'GET', '/api/findings?session=nobody')).toEqual({ findings: [], unknownTurn: true });
    expect(await request(info, 'GET', '/api/findings?since=gone')).toEqual({ findings: [], turnId: 'gone', unknownTurn: true });
    expect(calls.findings).toEqual([
      { session: 's1', touchedOnly: false },
      { session: 'nobody', touchedOnly: false },
      { since: 'gone', touchedOnly: false },
    ]);
  });

  it('passes touched files on', async () => {
    const { deps, calls } = fakeDeps();
    server = await startServer(deps);
    const info = { port: server.port, token: TOKEN };
    await request(info, 'POST', '/api/touched', { files: ['C:/p/a.ts'], toolUseId: 'tu1', sessionId: 's1' });
    expect(calls.touched).toEqual([{ files: ['C:/p/a.ts'], toolUseId: 'tu1', sessionId: 's1' }]);
  });

  it('validates input', async () => {
    server = await startServer(fakeDeps().deps);
    const info = { port: server.port, token: TOKEN };
    const status = (p: Promise<unknown>) => p.then(() => 200, (e: DaemonRequestError) => e.status);
    expect(await status(request(info, 'POST', '/api/touched', { files: 'a.ts' }))).toBe(400);
    expect(await status(request(info, 'GET', '/api/findings'))).toBe(400);
    expect(await status(request(info, 'GET', '/api/findings?session=&since='))).toBe(400);
    expect(await status(request(info, 'GET', '/api/findings?since=t&certainty=maybe'))).toBe(400);
    expect(await status(request(info, 'GET', '/api/nope'))).toBe(404);
  });

  it('calls shutdown after answering', async () => {
    const { deps, calls } = fakeDeps();
    server = await startServer(deps);
    expect(await request({ port: server.port, token: TOKEN }, 'POST', '/api/shutdown')).toEqual({ ok: true });
    await waitFor(() => calls.shutdown === 1);
  });
});

describe('WebSocket', () => {
  it('closes clients that send a wrong token or nothing', async () => {
    server = await startServer(fakeDeps().deps, { helloTimeoutMs: 200 });
    const wrong = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    wrong.on('open', () => wrong.send(JSON.stringify({ type: 'hello', token: 'nope' })));
    expect(await closeCode(wrong)).toBe(4401);
    const silent = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    expect(await closeCode(silent)).toBe(4401);
    expect(server.clientCount()).toBe(0);
  });

  it('survives a malformed upgrade request', async () => {
    server = await startServer(fakeDeps().deps);
    const sock = net.connect(server.port, '127.0.0.1');
    await new Promise<void>((resolve) => sock.once('connect', () => resolve()));
    const closed = new Promise<void>((resolve) => sock.once('close', () => resolve()));
    sock.on('error', () => {});
    sock.resume();
    sock.write('GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    await closed;
    expect(await request({ port: server.port, token: TOKEN }, 'GET', '/api/status')).toMatchObject({ ok: true });
  });

  it('rejects a WebSocket upgrade with a foreign Host header', async () => {
    server = await startServer(fakeDeps().deps);
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers: { host: 'evil.example' } });
    const outcome = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('error'));
    });
    expect(outcome).toBe('error');
    expect(server.clientCount()).toBe(0);
  });

  it('sends nothing to a socket that has not said hello', async () => {
    server = await startServer(fakeDeps().deps, { helloTimeoutMs: 60_000 });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const received: unknown[] = [];
    ws.on('message', (d) => received.push(d));
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    server.broadcast({ type: 'activity', at: 1, files: [] });
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toEqual([]);
    ws.terminate();
  });

  it('sends the graph after hello and then broadcasts', async () => {
    server = await startServer(fakeDeps().deps);
    const client = await connect({ port: server.port, token: TOKEN });
    expect(client.messages[0]).toEqual({ type: 'graph', seq: 0, graph: emptyGraph });
    expect(server.clientCount()).toBe(1);
    server.broadcast({ type: 'activity', at: 1, files: [{ path: 'a.ts', by: 'claude' }] });
    await waitFor(() => client.messages.length === 2);
    expect(client.messages[1]).toEqual({ type: 'activity', at: 1, files: [{ path: 'a.ts', by: 'claude' }] });
    client.close();
    await waitFor(() => server!.clientCount() === 0);
  });
});

describe('request helper', () => {
  it('throws DaemonRequestError for a non-JSON answer', async () => {
    const html = http.createServer((_req, res) => {
      res.writeHead(502, 'Bad Gateway', { 'content-type': 'text/html' });
      res.end('<html>nope</html>');
    });
    await new Promise<void>((resolve) => html.listen(0, '127.0.0.1', () => resolve()));
    const port = (html.address() as net.AddressInfo).port;
    try {
      await expect(request({ port, token: 't' }, 'GET', '/x')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
    } finally {
      html.closeAllConnections();
      await new Promise<void>((resolve) => html.close(() => resolve()));
    }
  });
});

describe('plugin routes', () => {
  it('passes bash and session through /api/touched and answers /api/stop', async () => {
    const { deps, calls } = fakeDeps();
    server = await startServer(deps);
    const info = { port: server.port, token: TOKEN };
    await request(info, 'POST', '/api/touched', { files: [], sessionId: 's1', bash: true });
    expect(calls.touched[0]).toEqual({ files: [], toolUseId: undefined, sessionId: 's1', bash: true });
    expect(await request(info, 'POST', '/api/stop', { sessionId: 's1' })).toMatchObject({ turnId: 'turn-1', total: 0 });
    await request(info, 'POST', '/api/stop', {});
    expect(calls.stop).toEqual(['s1', 'default']);
  });

  it('serves overview, similar and node', async () => {
    server = await startServer(fakeDeps().deps);
    const info = { port: server.port, token: TOKEN };
    expect(await request(info, 'GET', '/api/overview')).toEqual({ text: 'overview default' });
    expect(await request(info, 'GET', '/api/overview?maxNodes=12')).toEqual({ text: 'overview 12' });
    await expect(request(info, 'GET', '/api/overview?maxNodes=0')).rejects.toMatchObject({ status: 400 });
    const { matches } = await request<{ matches: { name: string }[] }>(info, 'POST', '/api/similar', { name: 'formatDate' });
    expect(matches[0].name).toBe('formatDate');
    await expect(request(info, 'POST', '/api/similar', { code: 'x'.repeat(20_001) })).rejects.toMatchObject({ status: 400 });
    await expect(request(info, 'POST', '/api/similar', { name: 3 })).rejects.toMatchObject({ status: 400 });
    expect(await request(info, 'GET', '/api/node?id=known')).toEqual({ text: 'details' });
    expect(await request(info, 'GET', '/api/node?path=lib%2Fa.ts')).toEqual({ text: 'details' });
    await expect(request(info, 'GET', '/api/node?id=nope')).rejects.toMatchObject({ status: 404 });
    await expect(request(info, 'GET', '/api/node')).rejects.toMatchObject({ status: 400 });
  });
});

describe('map view routes', () => {
  it('validates and forwards lock, request, dismiss, layout and source calls', async () => {
    const { deps, calls } = fakeDeps();
    server = await startServer(deps);
    const info = { port: server.port, token: TOKEN };
    await expect(request(info, 'POST', '/api/locks', { nodeId: 'x' })).rejects.toMatchObject({ status: 400 });
    await request(info, 'POST', '/api/locks', { nodeId: 'x', locked: true });
    expect(calls.setLock).toEqual([['x', true]]);

    await expect(request(info, 'POST', '/api/requests', { kind: 'nope', text: 'a' })).rejects.toMatchObject({ status: 400 });
    await request(info, 'POST', '/api/requests', { kind: 'explain', text: 'Explain', nodeId: 'n1' });
    expect(calls.addRequest).toEqual([{ kind: 'explain', text: 'Explain', nodeId: 'n1' }]);
    await request(info, 'POST', '/api/requests/cancel', { id: 'r1' });
    await request(info, 'POST', '/api/requests/claim', { sessionId: 's1' });
    expect(calls.cancelRequest).toEqual(['r1']);
    expect(calls.claimRequests).toEqual(['s1']);

    await expect(request(info, 'POST', '/api/dismiss', {})).rejects.toMatchObject({ status: 400 });
    await request(info, 'POST', '/api/dismiss', { findingId: 'f1' });
    expect(calls.dismiss).toEqual(['f1']);

    await expect(request(info, 'POST', '/api/layout', { slots: { a: -1 } })).rejects.toMatchObject({ status: 400 });
    await request(info, 'POST', '/api/layout', { slots: { a: 2 } });
    expect(calls.saveLayout).toEqual([{ a: 2 }]);
    expect(await request(info, 'GET', '/api/layout')).toEqual({ version: 1, slots: {} });

    expect(await request(info, 'GET', '/api/source?file=lib%2Fa.ts&start=2&end=3')).toMatchObject({ file: 'lib/a.ts' });
    expect(calls.source).toEqual([['lib/a.ts', 2, 3]]);
    await expect(request(info, 'GET', '/api/source?file=nope.ts')).rejects.toMatchObject({ status: 404 });
    await expect(request(info, 'GET', '/api/source')).rejects.toMatchObject({ status: 400 });
    await expect(request(info, 'GET', '/api/source?file=a.ts&start=x')).rejects.toMatchObject({ status: 400 });
  });

  it('passes HttpError statuses from deps through', async () => {
    const { deps } = fakeDeps({
      setLock: async () => {
        throw new HttpError(409, 'locked through lib/');
      },
    });
    server = await startServer(deps);
    await expect(request({ port: server.port, token: TOKEN }, 'POST', '/api/locks', { nodeId: 'x', locked: false })).rejects.toMatchObject({
      status: 409,
      message: 'locked through lib/',
    });
  });
});
