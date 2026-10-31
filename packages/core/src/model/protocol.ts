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

/** Messages the daemon sends over WebSocket. */
export type ServerMessage =
  | { type: 'graph'; seq: number; graph: PublicGraph }
  | { type: 'delta'; seq: number; delta: GraphDelta }
  | { type: 'activity'; at: number; files: ActivityFile[] };

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
