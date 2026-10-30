import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Certainty, ClientMessage, DaemonStatus, Finding, PublicGraph, ServerMessage } from '@mapskill/core';
import { WebSocket, WebSocketServer } from 'ws';

export interface FindingsQuery {
  since?: string;
  session?: string;
  touchedOnly: boolean;
  certainty?: Certainty;
}

export interface FindingsAnswer {
  findings: Finding[];
  turnId?: string;
  unknownTurn: boolean;
}

export interface ServerDeps {
  token: string;
  status(): DaemonStatus;
  graph(): Promise<PublicGraph>;
  /** First message for a client that said hello: the full graph. */
  hello(): Promise<ServerMessage>;
  touched(input: { files: string[]; toolUseId?: string; sessionId?: string }): Promise<void>;
  startTurn(sessionId: string): Promise<string>;
  /**
   * New findings for a turn, given by id (`since`) or as the current turn of a session (`session`); `since` wins when
   * both are given. `unknownTurn` is true (and `findings` empty) when the turn is not known or the session has none.
   */
  findings(query: FindingsQuery): Promise<FindingsAnswer>;
  shutdown(): void;
  /** Called for every authenticated request or message (keeps the daemon from idling out). */
  activity(): void;
}

export interface DaemonServer {
  port: number;
  broadcast(m: ServerMessage): void;
  clientCount(): number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'body must be a JSON object');
  return parsed as Record<string, unknown>;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function startServer(deps: ServerDeps, options: { helloTimeoutMs?: number } = {}): Promise<DaemonServer> {
  let port = 0;
  const clients = new Set<WebSocket>();
  const allowedHost = (host: string | undefined): boolean => host === `127.0.0.1:${port}` || host === `localhost:${port}`;

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!allowedHost(req.headers.host)) throw new HttpError(403, 'forbidden host');
    if (!sameToken(req.headers['x-mapskill-token'], deps.token)) throw new HttpError(401, 'missing or wrong token');
    deps.activity();
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/status':
        return send(res, 200, deps.status());
      case 'GET /api/graph':
        return send(res, 200, await deps.graph());
      case 'POST /api/touched': {
        const body = await readBody(req);
        const files = body.files;
        if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) throw new HttpError(400, 'files must be a list of strings');
        await deps.touched({ files: files as string[], toolUseId: optionalString(body.toolUseId), sessionId: optionalString(body.sessionId) });
        return send(res, 200, { ok: true });
      }
      case 'POST /api/turn': {
        const body = await readBody(req);
        return send(res, 200, { turnId: await deps.startTurn(optionalString(body.sessionId) ?? 'default') });
      }
      case 'GET /api/findings': {
        const since = url.searchParams.get('since');
        const session = url.searchParams.get('session');
        if (!since && !session) throw new HttpError(400, 'since or session is required');
        const certainty = url.searchParams.get('certainty');
        if (certainty !== null && certainty !== 'certain' && certainty !== 'likely') throw new HttpError(400, 'certainty must be certain or likely');
        const answer = await deps.findings({
          ...(since ? { since } : { session: session! }),
          touchedOnly: url.searchParams.get('touchedOnly') === 'true',
          ...(certainty ? { certainty } : {}),
        });
        return send(res, 200, answer);
      }
      case 'POST /api/shutdown':
        send(res, 200, { ok: true });
        setImmediate(() => deps.shutdown());
        return;
      default:
        throw new HttpError(404, 'not found');
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return;
      if (err instanceof HttpError) send(res, err.status, { error: err.message });
      else send(res, 500, { error: 'internal error' });
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    // Compare the raw path: URL parsing of attacker-controlled input could throw.
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== '/ws' || !allowedHost(req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const timer = setTimeout(() => ws.close(4401, 'hello required'), options.helloTimeoutMs ?? 2000);
      ws.once('message', (data) => {
        clearTimeout(timer);
        let msg: Partial<ClientMessage> | undefined;
        try {
          msg = JSON.parse(String(data)) as Partial<ClientMessage>;
        } catch {
          msg = undefined;
        }
        if (msg?.type !== 'hello' || !sameToken(msg.token, deps.token)) {
          ws.close(4401, 'wrong token');
          return;
        }
        deps.activity();
        ws.on('message', () => deps.activity());
        deps.hello().then(
          (first) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify(first));
            clients.add(ws);
          },
          () => ws.close(1011, 'graph unavailable'),
        );
      });
      ws.on('close', () => {
        clearTimeout(timer);
        clients.delete(ws);
      });
      ws.on('error', () => clients.delete(ws));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  // After listening, a late 'error' event must not crash the process.
  server.on('error', () => {});

  return {
    port,
    broadcast(m) {
      const text = JSON.stringify(m);
      for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
    },
    clientCount: () => clients.size,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
