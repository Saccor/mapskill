import { applyDelta, type LockInfo, type MapRequest, type PublicGraph, type ServerMessage } from '@mapskill/core/client';

export const PULSE_MS = 10_000;
const MAX_ACTIVITY = 50;

export interface Activity {
  at: number;
  files: { path: string; by: 'claude' | 'watcher' }[];
}

export interface MapState {
  status: 'connecting' | 'live' | 'reconnecting';
  graph: PublicGraph | null;
  seq: number;
  activity: Activity[];
  pulseUntil: Record<string, number>;
  touchedThisTurn: string[];
  turnStartedAt: number | null;
  requests: MapRequest[];
  locks: LockInfo[];
  lockedFiles: string[];
  needsResync: boolean;
}

export const initialState: MapState = {
  status: 'connecting',
  graph: null,
  seq: 0,
  activity: [],
  pulseUntil: {},
  touchedThisTurn: [],
  turnStartedAt: null,
  requests: [],
  locks: [],
  lockedFiles: [],
  needsResync: false,
};

export type Action =
  | { type: 'server'; message: ServerMessage; now: number }
  | { type: 'status'; status: MapState['status'] }
  | { type: 'requests'; requests: MapRequest[] }
  | { type: 'locks'; locks: LockInfo[]; lockedFiles: string[] };

function onServer(state: MapState, m: ServerMessage): MapState {
  switch (m.type) {
    case 'graph':
      return { ...state, graph: m.graph, seq: m.seq, needsResync: false, status: 'live' };
    case 'delta':
      if (!state.graph || m.seq !== state.seq + 1) return { ...state, needsResync: true };
      return { ...state, graph: applyDelta(state.graph, m.delta), seq: m.seq };
    case 'activity': {
      const pulseUntil = { ...state.pulseUntil };
      for (const f of m.files) pulseUntil[f.path] = m.at + PULSE_MS;
      const touched = [...new Set([...state.touchedThisTurn, ...m.files.map((f) => f.path)])].sort();
      return { ...state, activity: [{ at: m.at, files: m.files }, ...state.activity].slice(0, MAX_ACTIVITY), pulseUntil, touchedThisTurn: touched };
    }
    case 'turn':
      return { ...state, touchedThisTurn: [], turnStartedAt: m.at };
    case 'requests':
      return { ...state, requests: m.requests };
    case 'locks':
      return { ...state, locks: m.locks, lockedFiles: m.lockedFiles };
  }
}

export function reduce(state: MapState, action: Action): MapState {
  switch (action.type) {
    case 'server':
      return onServer(state, action.message);
    case 'status':
      return { ...state, status: action.status };
    case 'requests':
      return { ...state, requests: action.requests };
    case 'locks':
      return { ...state, locks: action.locks, lockedFiles: action.lockedFiles };
  }
}
