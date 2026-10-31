import { randomUUID } from 'node:crypto';
import type { MapRequest, RequestKind } from '@mapskill/core';
import { ensureMapskillDir, mapskillPath, readJson, writeJsonAtomic } from './paths';

export const MAX_REQUEST_CHARS = 2000;
export const MAX_REQUESTS = 200;
const FILE = 'requests.json';
const KINDS: RequestKind[] = ['explain', 'fix', 'custom'];

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
    this.requests.push(request);
    this.prune();
    this.save();
    return { ...request };
  }

  cancel(id: string): boolean {
    const r = this.requests.find((x) => x.id === id && x.status === 'pending');
    if (!r) return false;
    r.status = 'cancelled';
    this.save();
    return true;
  }

  /** Returns every pending request (oldest first) and marks them sent. */
  claimPending(): MapRequest[] {
    const pending = this.requests.filter((r) => r.status === 'pending');
    if (pending.length === 0) return [];
    const at = this.now();
    for (const r of pending) {
      r.status = 'sent';
      r.sentAt = at;
    }
    this.save();
    return pending.map((r) => ({ ...r }));
  }

  private prune(): void {
    while (this.requests.length > MAX_REQUESTS) {
      const at = this.requests.findIndex((r) => r.status !== 'pending');
      if (at < 0) break;
      this.requests.splice(at, 1);
    }
  }

  private save(): void {
    ensureMapskillDir(this.root);
    writeJsonAtomic(mapskillPath(this.root, FILE), { version: 1, requests: this.requests });
  }
}
