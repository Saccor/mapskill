import type { PublicGraph, Zone } from '@mapskill/core/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapState } from './reducer';
import type { Api } from './api';
import { assignSlots } from './layout';

const SAVE_DELAY_MS = 1000;
const MAX_SAVED = 10_000;
export const LOAD_TIMEOUT_MS = 5000;
export const LOAD_RETRY_MS = 10_000;
export const MAX_LOAD_FAILURES = 3;

/** Slots to persist: everything known so far plus the current ones; over the cap, ids outside the graph go first. */
export function mergeForSave(
  known: Record<string, number>,
  current: Record<string, number>,
  preferKnown = false,
): Record<string, number> {
  const merged = preferKnown ? { ...current, ...known } : { ...known, ...current };
  const keys = Object.keys(merged);
  if (keys.length <= MAX_SAVED) return merged;
  const kept = [...keys.filter((k) => k in current), ...keys.filter((k) => !(k in current))].slice(0, MAX_SAVED);
  return Object.fromEntries(kept.map((k) => [k, merged[k]]));
}

/**
 * Remembered slots minus those a returning part (absent from prevSlots) must not take back:
 * the slot is held in the same zone by a part that was already placed. Existing parts never move.
 */
export function restorableSlots(
  prevSlots: Record<string, number>,
  remembered: Record<string, number>,
  nodes: { id: string; zone: Zone }[],
): Record<string, number> {
  const held = new Set<string>();
  for (const n of nodes) if (n.id in prevSlots) held.add(`${n.zone}:${prevSlots[n.id]}`);
  const out = { ...remembered };
  for (const n of nodes) {
    if (n.id in prevSlots) continue;
    const slot = remembered[n.id];
    if (slot !== undefined && held.has(`${n.zone}:${slot}`)) delete out[n.id];
  }
  return out;
}

/** Slots for the current parts: parts already placed keep their last computed slot even before it is saved. */
export function computeSlots(
  nodes: { id: string; zone: Zone }[],
  saved: Record<string, number>,
  lastSaved: Record<string, number>,
  prevSlots: Record<string, number>,
): Record<string, number> {
  return assignSlots(nodes, restorableSlots(prevSlots, { ...saved, ...lastSaved, ...prevSlots }, nodes));
}

export type LayoutLoad = { loaded: boolean; failures: number };
export type LayoutPhase = 'loading' | 'degraded' | 'loaded';

/** loading: keep the map waiting. degraded: show it with no remembered layout. loaded: the saved layout is in. */
export function layoutPhase(s: LayoutLoad): LayoutPhase {
  if (s.loaded) return 'loaded';
  return s.failures >= MAX_LOAD_FAILURES ? 'degraded' : 'loading';
}

/** Saving is allowed only once the saved layout has been read, so a partial layout never replaces it. */
export function shouldSave(s: LayoutLoad & { dirty: boolean }): boolean {
  return s.loaded && s.dirty;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Slots for every part: saved ones from .mapskill/layout.json, new ones assigned and saved after a quiet second.
 * Null while the layout is still loading (it is retried on reconnect and every 10 s); after three failed
 * attempts the map shows without it, but nothing is saved until a load succeeds.
 */
export function useSlots(graph: PublicGraph | null, api: Api, status: MapState['status']): Record<string, number> | null {
  const [saved, setSaved] = useState<Record<string, number> | null>(null);
  const [load, setLoad] = useState<LayoutLoad>({ loaded: false, failures: 0 });
  // Everything persisted so far (server file plus saves this session), including parts that are gone for now.
  const lastSaved = useRef<Record<string, number>>({});
  const prevSlots = useRef<Record<string, number>>({});
  // True after a load that came late: slots computed without the layout must not overwrite what was saved.
  const recovered = useRef(false);
  const loadedRef = useRef(false);
  const inFlight = useRef(false);
  const failuresRef = useRef(0);
  const attemptRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const attempt = (): void => {
      if (cancelled || loadedRef.current || inFlight.current) return;
      inFlight.current = true;
      withTimeout(api.layout(), LOAD_TIMEOUT_MS).then(
        (l) => {
          inFlight.current = false;
          if (cancelled) return;
          loadedRef.current = true;
          recovered.current = failuresRef.current >= MAX_LOAD_FAILURES;
          lastSaved.current = { ...l.slots };
          setSaved(l.slots);
          setLoad({ loaded: true, failures: failuresRef.current });
        },
        (err: unknown) => {
          inFlight.current = false;
          if (cancelled) return;
          console.warn('layout load failed', err);
          failuresRef.current += 1;
          if (failuresRef.current === MAX_LOAD_FAILURES) setSaved((s) => s ?? {});
          setLoad({ loaded: false, failures: failuresRef.current });
        },
      );
    };
    attempt();
    const timer = setInterval(attempt, LOAD_RETRY_MS);
    attemptRef.current = attempt;
    return () => {
      cancelled = true;
      inFlight.current = false;
      clearInterval(timer);
      attemptRef.current = null;
    };
  }, [api]);
  useEffect(() => {
    // A connection that comes back is the best moment to try again.
    if (status === 'live') attemptRef.current?.();
  }, [status]);

  const phase = layoutPhase(load);
  const slots = useMemo(
    () => (graph && saved && phase !== 'loading' ? computeSlots(graph.nodes, saved, lastSaved.current, prevSlots.current) : null),
    [graph, saved, phase],
  );
  useEffect(() => {
    if (slots) prevSlots.current = slots;
  }, [slots]);
  useEffect(() => {
    if (!graph || !slots) return;
    const dirty = !Object.entries(slots).every(([id, slot]) => lastSaved.current[id] === slot);
    if (!shouldSave({ ...load, dirty })) return;
    const timer = setTimeout(() => {
      const merged = mergeForSave(lastSaved.current, slots, recovered.current);
      api.saveLayout(merged).then(
        () => {
          lastSaved.current = merged;
          recovered.current = false;
        },
        (err: unknown) => console.warn('layout save failed', err),
      );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [slots, load, graph, api]);
  return slots;
}
