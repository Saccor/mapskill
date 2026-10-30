import type { GraphDelta, PublicGraph } from '../graph/delta';

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
