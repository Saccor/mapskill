import type { GraphDelta, PublicGraph } from '../graph/delta';
import type { Finding } from './types';

/** Answer to POST /api/stop: what the Stop hook should tell Claude. */
export interface StopAnswer {
  turnId?: string;
  /** True when the session has no turn the daemon knows (then nothing is reported). */
  unknownTurn: boolean;
  /** True when this turn already blocked Claude once; `findings` is then empty. */
  alreadyReported: boolean;
  /** How many new certain findings Claude's files have in this turn. */
  total: number;
  /** At most 5 of them. */
  findings: Finding[];
}

export interface ActivityFile {
  path: string;
  by: 'claude' | 'watcher';
}

export interface LockInfo {
  path: string;
  label?: string;
  lockedAt: number;
}

export type RequestKind = 'explain' | 'fix' | 'custom';
export type RequestStatus = 'pending' | 'sent' | 'cancelled';

/** A request the user queued in the map for Claude. */
export interface MapRequest {
  id: string;
  kind: RequestKind;
  text: string;
  nodeId?: string;
  findingId?: string;
  createdAt: number;
  status: RequestStatus;
  sentAt?: number;
}

/** Saved box positions: node id -> slot number within its zone. */
export interface LayoutFile {
  version: 1;
  slots: Record<string, number>;
}

export interface LocksAnswer {
  locks: LockInfo[];
  lockedFiles: string[];
}

/** A window of lines from one source file. `start` and `end` are 1-based, inclusive. */
export interface SourceAnswer {
  file: string;
  start: number;
  end: number;
  total: number;
  lines: string[];
}

/** Messages the daemon sends over WebSocket. */
export type ServerMessage =
  | { type: 'graph'; seq: number; graph: PublicGraph }
  | { type: 'delta'; seq: number; delta: GraphDelta }
  | { type: 'activity'; at: number; files: ActivityFile[] }
  | { type: 'turn'; at: number; sessionId: string }
  | { type: 'requests'; requests: MapRequest[] }
  | { type: 'locks'; locks: LockInfo[]; lockedFiles: string[] };

/** The only message a client sends: it must be the first one. */
export type ClientMessage = { type: 'hello'; token: string };

export interface DaemonStatus {
  ok: true;
  root: string;
  pid: number;
  version: string;
  /** False while the first scan is still running. */
  ready: boolean;
  fileCount: number;
  clients: number;
  seq: number;
}
