import { randomUUID } from 'node:crypto';
import type { MapRequest, RequestKind } from '@mapskill/core';
import { ensureMapskillDir, mapskillPath, readJson, writeJsonAtomic } from './paths';

export const MAX_REQUEST_CHARS = 2000;
export const MAX_REQUESTS = 200;
const FILE = 'requests.json';
const KINDS: RequestKind[] = ['explain', 'fix', 'custom', 'build'];

function valid(r: unknown): r is MapRequest {
  const x = r as MapRequest;
  return (
    typeof x === 'object' && x !== null && typeof x.id === 'string' && typeof x.text === 'string' &&
    KINDS.includes(x.kind) && ['pending', 'sent', 'cancelled'].includes(x.status) && typeof x.createdAt === 'number'
  );
}

/** The map's request queue in .mapskill/requests.json: written by the map, read by the UserPromptSubmit hook via the daemon. */
export class RequestQueue {
  private requests: MapRequest[];

  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now,
  ) {
    const data = readJson<{ requests?: unknown[] }>(mapskillPath(root, FILE));
    this.requests = Array.isArray(data?.requests) ? data.requests.filter(valid) : [];
  }

  list(): MapRequest[] {
    return this.requests.map((r) => ({ ...r }));
  }

  add(input: { kind: RequestKind; text: string; nodeId?: string; findingId?: string }): MapRequest {
    const text = input.text.trim();
    if (text === '' || text.length > MAX_REQUEST_CHARS) throw new RangeError(`text must be 1-${MAX_REQUEST_CHARS} characters`);
    const request: MapRequest = {
      id: randomUUID(),
      kind: input.kind,
      text,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.findingId ? { findingId: input.findingId } : {}),
      createdAt: this.now(),
      status: 'pending',
    };
    this.commit(prune([...this.requests, request]));
    return { ...request };
  }

  cancel(id: string): boolean {
    if (!this.requests.some((x) => x.id === id && x.status === 'pending')) return false;
    this.commit(this.requests.map((x) => (x.id === id ? { ...x, status: 'cancelled' as const } : x)));
    return true;
  }

  /** Returns every pending request (oldest first) and marks them sent. */
  claimPending(): MapRequest[] {
    if (!this.requests.some((r) => r.status === 'pending')) return [];
    const at = this.now();
    const next = this.requests.map((r) => (r.status === 'pending' ? { ...r, status: 'sent' as const, sentAt: at } : r));
    const before = new Set(this.requests.filter((r) => r.status === 'pending').map((r) => r.id));
    this.commit(next);
    return next.filter((r) => before.has(r.id)).map((r) => ({ ...r }));
  }

  /** Writes first, then remembers: a failed write leaves the queue in memory as it was. */
  private commit(next: MapRequest[]): void {
    ensureMapskillDir(this.root);
    writeJsonAtomic(mapskillPath(this.root, FILE), { version: 1, requests: next });
    this.requests = next;
  }
}

function prune(requests: MapRequest[]): MapRequest[] {
  const out = [...requests];
  while (out.length > MAX_REQUESTS) {
    const at = out.findIndex((r) => r.status !== 'pending');
    if (at < 0) break;
    out.splice(at, 1);
  }
  return out;
}
