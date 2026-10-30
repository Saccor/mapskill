import http from 'node:http';
import type { PublicGraph } from '@mapskill/core';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { connect, waitFor } from '../test-utils';
import { DaemonRequestError, request } from './client';
import { startServer, type DaemonServer, type ServerDeps } from './server';

const TOKEN = 'secret-token';
const emptyGraph: PublicGraph = {
  root: '/p', framework: 'nextjs', nodes: [], edges: [], findings: [], health: {}, fileCount: 0, unreadableFiles: [],
};

function fakeDeps(over: Partial<ServerDeps> = {}) {
  const calls = { touched: [] as unknown[], findings: [] as unknown[], shutdown: 0, activity: 0 };
  const deps: ServerDeps = {
    token: TOKEN,
    status: () => ({ ok: true, root: '/p', pid: process.pid, version: 'test', ready: true, fileCount: 0, clients: 0, seq: 0 }),
    graph: async () => emptyGraph,
    hello: async () => ({ type: 'graph', seq: 0, graph: emptyGraph }),
    touched: async (input) => {
      calls.touched.push(input);
    },
    startTurn: async () => 'turn-1',
    findings: async (turnId, query) => {
      calls.findings.push({ turnId, query });
      return [];
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
    expect(await request(info, 'GET', '/api/findings?since=turn-1&touchedOnly=true&certainty=certain')).toEqual({ findings: [] });
    expect(calls.findings).toEqual([{ turnId: 'turn-1', query: { touchedOnly: true, certainty: 'certain' } }]);
    expect(calls.activity).toBe(4); // one per authenticated request
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
