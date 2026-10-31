import type { ServerMessage } from '@mapskill/core/client';
import { useEffect, useReducer, useRef } from 'react';
import { Api } from './api';
import { initialState, reduce, type Action, type MapState } from './reducer';

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

/** Keeps a WebSocket to the daemon open (with backoff) and turns its messages into map state. */
export function useMapConnection(token: string): { state: MapState; dispatch: (a: Action) => void; api: Api } {
  const [state, dispatch] = useReducer(reduce, initialState);
  const apiRef = useRef(new Api(token));
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const api = apiRef.current;
    const refreshSideData = (): void => {
      api.locks().then((l) => dispatch({ type: 'locks', locks: l.locks, lockedFiles: l.lockedFiles }), () => {});
      api.requests().then((r) => dispatch({ type: 'requests', requests: r }), () => {});
    };
    const connect = (): void => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/ws`);
      socketRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello', token }));
        refreshSideData();
      };
      ws.onmessage = (e) => {
        const message = JSON.parse(String(e.data)) as ServerMessage;
        if (message.type === 'graph') attempt = 0;
        dispatch({ type: 'server', message, now: Date.now() });
      };
      ws.onclose = () => {
        if (stopped) return;
        dispatch({ type: 'status', status: 'reconnecting' });
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        timer = setTimeout(connect, wait);
      };
    };
    connect();
    const onFocus = (): void => refreshSideData();
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      socketRef.current?.close();
    };
  }, [token]);

  // A delta arrived out of order: drop the socket; the reconnect starts with a full graph.
  useEffect(() => {
    if (state.needsResync) socketRef.current?.close();
  }, [state.needsResync]);

  return { state, dispatch, api: apiRef.current };
}
