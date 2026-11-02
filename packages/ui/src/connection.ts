import type { ServerMessage } from '@mapskill/core/client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Api } from './api';
import { initialState, reduce, type Action, type MapState } from './reducer';

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const STALE_AFTER_FAILURES = 5;

/** A frame from the daemon, or null when it is not valid JSON with a type (bad frames are dropped). */
export function parseFrame(data: string): ServerMessage | null {
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string') return value as ServerMessage;
  } catch {
    // dropped below
  }
  return null;
}

/** True once reconnecting has failed this many times in a row without a graph arriving. */
export function isStale(failedReconnects: number): boolean {
  return failedReconnects >= STALE_AFTER_FAILURES;
}

/** A gate that lets one `seen` message through per `minGapMs`: call it with the time, it says whether to send. */
export function seenThrottle(minGapMs = 60_000): (now: number) => boolean {
  let last = -Infinity;
  return (now) => {
    if (now - last < minGapMs) return false;
    last = now;
    return true;
  };
}

const isVisible = (): boolean => document.visibilityState === 'visible';

/** Keeps a WebSocket to the daemon open (with backoff) and turns its messages into map state. */
export function useMapConnection(token: string): { state: MapState; dispatch: (a: Action) => void; api: Api; stale: boolean } {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [stale, setStale] = useState(false);
  const apiRef = useRef<Api | null>(null);
  apiRef.current ??= new Api(token);
  const socketRef = useRef<WebSocket | null>(null);
  const resyncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const api = apiRef.current!;
    // The daemon counts a map view only when the user looks at the map: a hello from a visible tab, or `seen` later.
    const allowSeen = seenThrottle();
    const refreshSideData = (): void => {
      api.locks().then((l) => dispatch({ type: 'locks', locks: l.locks, lockedFiles: l.lockedFiles }), () => {});
      api.requests().then((r) => dispatch({ type: 'requests', requests: r }), () => {});
      api.goal().then((answer) => dispatch({ type: 'goal', answer }), () => {});
    };
    const connect = (): void => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/ws`);
      socketRef.current = ws;
      ws.onopen = () => {
        const seen = isVisible();
        if (seen) allowSeen(Date.now());
        ws.send(JSON.stringify({ type: 'hello', token, seen }));
        refreshSideData();
      };
      ws.onmessage = (e) => {
        const message = parseFrame(String(e.data));
        if (!message) return;
        if (message.type === 'graph') {
          attempt = 0;
          setStale(false);
        }
        dispatch({ type: 'server', message, now: Date.now() });
      };
      ws.onclose = () => {
        if (stopped) return;
        dispatch({ type: 'status', status: 'reconnecting' });
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        if (isStale(attempt)) setStale(true);
        timer = setTimeout(connect, wait);
      };
    };
    // A delta arrived out of order: silence the old socket (late frames must not reach the state, its close must not
    // schedule a second reconnect), then start over; the new connection begins with a full graph.
    resyncRef.current = () => {
      const old = socketRef.current;
      if (old) {
        old.onopen = null;
        old.onmessage = null;
        old.onclose = null;
        old.close();
      }
      clearTimeout(timer);
      connect();
    };
    connect();
    const reportSeen = (): void => {
      const ws = socketRef.current;
      if (!isVisible() || ws?.readyState !== WebSocket.OPEN || !allowSeen(Date.now())) return;
      ws.send(JSON.stringify({ type: 'seen' }));
    };
    const onFocus = (): void => {
      refreshSideData();
      reportSeen();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', reportSeen);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', reportSeen);
      resyncRef.current = null;
      socketRef.current?.close();
    };
  }, [token]);

  useEffect(() => {
    if (state.needsResync) resyncRef.current?.();
  }, [state.needsResync]);

  return { state, dispatch, api: apiRef.current, stale };
}
