import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  Certainty,
  ClientMessage,
  DaemonStatus,
  Finding,
  LayoutFile,
  LocksAnswer,
  MapRequest,
  PublicGraph,
  RequestKind,
  ServerMessage,
  SimilarMatch,
  SimilarQuery,
  SourceAnswer,
  StopAnswer,
} from '@mapskill/core';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_LAYOUT_ENTRIES } from './state-files';
import { isStaticRequest, serveStatic } from './static';

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
  /** The built map view's folder; null when it is not built. */
  uiDir: string | null;
  status(): DaemonStatus;
  graph(): Promise<PublicGraph>;
  /** First message for a client that said hello: the full graph. */
  hello(): Promise<ServerMessage>;
  touched(input: { files: string[]; toolUseId?: string; sessionId?: string; bash?: boolean }): Promise<void>;
  startTurn(sessionId: string): Promise<string>;
  /**
   * New findings for a turn, given by id (`since`) or as the current turn of a session (`session`); `since` wins when
   * both are given. `session` may be `latest`: the session that most recently started a turn or touched a file.
   * `unknownTurn` is true (and `findings` empty) when the turn is not known or the session has none.
   */
  findings(query: FindingsQuery): Promise<FindingsAnswer>;
  /** The Stop hook's question: new certain findings in Claude's files this turn, reported once per turn. */
  stopCheck(sessionId: string): Promise<StopAnswer>;
  overview(maxNodes?: number): Promise<string>;
  similar(query: SimilarQuery): Promise<SimilarMatch[]>;
  /** Text about a node (by id) or the nodes of a file (by path); null when nothing matches. */
  node(query: { id?: string; path?: string }): Promise<string | null>;
  /** The locks and which of the project's files they cover. */
  locks(): Promise<LocksAnswer>;
  /** Locks or unlocks the file of a map node; throws HttpError for unknown nodes (404), nodes without a file (400) or a lock that stays (409). */
  setLock(nodeId: string, locked: boolean): Promise<LocksAnswer>;
  /** The map's request queue. */
  requests(): Promise<MapRequest[]>;
  /** Queues a request from the map; throws RangeError for text that is empty or too long. */
  addRequest(input: { kind: RequestKind; text: string; nodeId?: string; findingId?: string }): Promise<MapRequest>;
  /** Cancels a pending request and returns the whole queue. */
  cancelRequest(id: string): Promise<MapRequest[]>;
  /** Hands the pending requests to a Claude session (the hook) and marks them sent. */
  claimRequests(sessionId: string): Promise<MapRequest[]>;
  /** Hides a finding until the code behind it changes; throws HttpError 404 for unknown findings. */
  dismiss(findingId: string): Promise<void>;
  /** The saved slot of each map node. */
  layout(): Promise<LayoutFile>;
  saveLayout(slots: Record<string, number>): Promise<void>;
  /** Lines of a project source file; null when the file is not one of the project's source files. */
  source(file: string, start?: number, end?: number): Promise<SourceAnswer | null>;
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
const MAX_SNIPPET_CHARS = 20_000;
const REQUEST_KINDS = new Set(['explain', 'fix', 'custom']);

export class HttpError extends Error {
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

function requiredString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v === '') throw new HttpError(400, `${name} must be a non-empty string`);
  return v;
}

function optionalPositiveInt(raw: string | null, name: string): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${name} must be a whole number from 1`);
  return n;
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
    const pathname = (req.url ?? '/').split('?')[0];
    if (isStaticRequest(req.method, pathname)) return serveStatic(deps.uiDir, req, res, pathname, port);
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
        await deps.touched({
          files: files as string[],
          toolUseId: optionalString(body.toolUseId),
          sessionId: optionalString(body.sessionId),
          ...(body.bash === true ? { bash: true } : {}),
        });
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
      case 'POST /api/stop': {
        const body = await readBody(req);
        return send(res, 200, await deps.stopCheck(optionalString(body.sessionId) ?? 'default'));
      }
      case 'GET /api/overview': {
        const raw = url.searchParams.get('maxNodes');
        const maxNodes = raw === null ? undefined : Number(raw);
        if (maxNodes !== undefined && (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 500)) {
          throw new HttpError(400, 'maxNodes must be a whole number from 1 to 500');
        }
        return send(res, 200, { text: await deps.overview(maxNodes) });
      }
      case 'POST /api/similar': {
        const body = await readBody(req);
        if ((body.name !== undefined && typeof body.name !== 'string') || (body.code !== undefined && typeof body.code !== 'string')) {
          throw new HttpError(400, 'name and code must be strings');
        }
        if (typeof body.code === 'string' && body.code.length > MAX_SNIPPET_CHARS) throw new HttpError(400, 'code is too long');
        return send(res, 200, { matches: await deps.similar({ name: body.name as string | undefined, code: body.code as string | undefined }) });
      }
      case 'GET /api/node': {
        const id = url.searchParams.get('id') ?? undefined;
        const p = url.searchParams.get('path') ?? undefined;
        if (!id && !p) throw new HttpError(400, 'id or path is required');
        const text = await deps.node(id ? { id } : { path: p });
        if (text === null) throw new HttpError(404, 'no such node');
        return send(res, 200, { text });
      }
      case 'GET /api/locks':
        return send(res, 200, await deps.locks());
      case 'POST /api/locks': {
        const body = await readBody(req);
        if (typeof body.locked !== 'boolean') throw new HttpError(400, 'locked must be true or false');
        return send(res, 200, await deps.setLock(requiredString(body.nodeId, 'nodeId'), body.locked));
      }
      case 'GET /api/requests':
        return send(res, 200, { requests: await deps.requests() });
      case 'POST /api/requests': {
        const body = await readBody(req);
        if (!REQUEST_KINDS.has(body.kind as string)) throw new HttpError(400, 'kind must be explain, fix or custom');
        const input = {
          kind: body.kind as RequestKind,
          text: requiredString(body.text, 'text'),
          ...(typeof body.nodeId === 'string' ? { nodeId: body.nodeId } : {}),
          ...(typeof body.findingId === 'string' ? { findingId: body.findingId } : {}),
        };
        try {
          return send(res, 200, { request: await deps.addRequest(input) });
        } catch (err) {
          if (err instanceof RangeError) throw new HttpError(400, err.message);
          throw err;
        }
      }
      case 'POST /api/requests/cancel': {
        const body = await readBody(req);
        return send(res, 200, { requests: await deps.cancelRequest(requiredString(body.id, 'id')) });
      }
      case 'POST /api/requests/claim': {
        const body = await readBody(req);
        return send(res, 200, { requests: await deps.claimRequests(optionalString(body.sessionId) ?? 'default') });
      }
      case 'POST /api/dismiss': {
        const body = await readBody(req);
        await deps.dismiss(requiredString(body.findingId, 'findingId'));
        return send(res, 200, { ok: true });
      }
      case 'GET /api/layout':
        return send(res, 200, await deps.layout());
      case 'POST /api/layout': {
        const body = await readBody(req);
        const slots = body.slots;
        if (!slots || typeof slots !== 'object' || Array.isArray(slots)) throw new HttpError(400, 'slots must be an object');
        const entries = Object.entries(slots as Record<string, unknown>);
        if (entries.length > MAX_LAYOUT_ENTRIES) throw new HttpError(400, 'too many slots');
        if (!entries.every(([, v]) => typeof v === 'number' && Number.isInteger(v) && v >= 0)) {
          throw new HttpError(400, 'every slot must be a whole number from 0');
        }
        await deps.saveLayout(slots as Record<string, number>);
        return send(res, 200, { ok: true });
      }
      case 'GET /api/source': {
        const file = url.searchParams.get('file');
        if (!file) throw new HttpError(400, 'file is required');
        const answer = await deps.source(
          file,
          optionalPositiveInt(url.searchParams.get('start'), 'start'),
          optionalPositiveInt(url.searchParams.get('end'), 'end'),
        );
        if (!answer) throw new HttpError(404, 'not a source file of this project');
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
