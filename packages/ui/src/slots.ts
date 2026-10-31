import type { GoalStatus, PublicGraph, Zone } from '@mapskill/core/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapState } from './reducer';
import type { Api } from './api';
import { assignSlots } from './layout';
import { GHOST_PREFIX } from './goals';

const SAVE_DELAY_MS = 1000;
const MAX_SAVED = 10_000;
export const LOAD_TIMEOUT_MS = 5000;
export const LOAD_RETRY_MS = 10_000;
export const MAX_LOAD_FAILURES = 3;

/** Slots to persist: everything known so far plus the current ones; over the cap, ids outside the graph go first. */
export function mergeForSave(
  known: Record<string, number>,
  current: Record<string, number>,
): Record<string, number> {
  const merged = { ...known, ...current };
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

/**
 * When a goal item is done, the part that satisfied it takes over the slot its ghost had, so the map does not
 * grow or shift. The ghost's slot must be free: no present part holds it. The heir is the first matched part in
 * the ghost's zone that either has no slot yet, or has one but was first seen in this session while a ghost was
 * shown (`fresh`, never a part from the layout loaded at session start). That covers multi-step builds, where
 * the route appears before the item turns done. Such a part moves once, from its fresh slot to the ghost's slot;
 * its old slot is released and no other part moves.
 * Returns extra remembered slots to merge in.
 */
export function inheritGhostSlots(
  nodes: { id: string; zone: Zone }[],
  remembered: Record<string, number>,
  goal: GoalStatus | null,
  fresh: ReadonlySet<string> = new Set(),
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!goal) return out;
  const held = new Set<string>();
  for (const n of nodes) if (n.id in remembered) held.add(`${n.zone}:${remembered[n.id]}`);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const item of goal.items) {
    if (!item.done || !item.zone) continue;
    const slot = remembered[`${GHOST_PREFIX}${item.id}`];
    if (slot === undefined) continue;
    const key = `${item.zone}:${slot}`;
    if (held.has(key)) continue;
    const heir = item.matchedNodeIds
      .map((id) => byId.get(id))
      .find((n) => n && n.zone === item.zone && (!(n.id in remembered) || fresh.has(n.id)));
    if (!heir) continue;
    if (heir.id in remembered) held.delete(`${heir.zone}:${remembered[heir.id]}`);
    out[heir.id] = slot;
    held.add(key);
  }
  return out;
}

/** Slots for the current parts: parts already placed keep their last computed slot even before it is saved. */
export function computeSlots(
  nodes: { id: string; zone: Zone }[],
  saved: Record<string, number>,
  lastSaved: Record<string, number>,
  prevSlots: Record<string, number>,
  goal: GoalStatus | null = null,
  fresh: ReadonlySet<string> = new Set(),
): Record<string, number> {
  const remembered = { ...saved, ...lastSaved, ...prevSlots };
  return assignSlots(nodes, restorableSlots(prevSlots, { ...remembered, ...inheritGhostSlots(nodes, remembered, goal, fresh) }, nodes));
}

/** The slot bookkeeping of one map session, free of React so the sequence of loads and saves can be tested. */
export class SlotSession {
  /** What the layout file holds (server file plus saves this session), including parts that are gone for now. */
  private lastSaved: Record<string, number> = {};
  private savedLayout: Record<string, number> = {};
  private prevSlots: Record<string, number> = {};
  /** Parts first seen after the first compute, while a ghost was shown, and not in the layout loaded at session start. */
  private freshWithGhost = new Set<string>();
  private computed = false;

  /** The layout file was read. After a degraded start the provisional slots are dropped, so the map switches to the saved layout. */
  loaded(layout: Record<string, number>, afterDegraded: boolean): void {
    this.lastSaved = { ...layout };
    this.savedLayout = layout;
    if (afterDegraded) this.prevSlots = {};
  }

  compute(nodes: { id: string; zone: Zone }[], goal: GoalStatus | null = null): Record<string, number> {
    if (this.computed && nodes.some((n) => n.id.startsWith(GHOST_PREFIX))) {
      for (const n of nodes) {
        if (!(n.id in this.prevSlots) && !(n.id in this.savedLayout) && !n.id.startsWith(GHOST_PREFIX)) this.freshWithGhost.add(n.id);
      }
    }
    this.computed = true;
    this.prevSlots = computeSlots(nodes, this.savedLayout, this.lastSaved, this.prevSlots, goal, this.freshWithGhost);
    return this.prevSlots;
  }

  /** What to save for these slots, or null when the file already has them. */
  pendingSave(slots: Record<string, number>): Record<string, number> | null {
    if (Object.entries(slots).every(([id, slot]) => this.lastSaved[id] === slot)) return null;
    return mergeForSave(this.lastSaved, slots);
  }

  saved(merged: Record<string, number>): void {
    this.lastSaved = merged;
  }
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
export function useSlots(graph: PublicGraph | null, api: Api, status: MapState['status'], goal: GoalStatus | null = null): Record<string, number> | null {
  const [saved, setSaved] = useState<Record<string, number> | null>(null);
  const [load, setLoad] = useState<LayoutLoad>({ loaded: false, failures: 0 });
  const session = useRef(new SlotSession());
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
          session.current.loaded(l.slots, failuresRef.current >= MAX_LOAD_FAILURES);
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
    () => (graph && saved && phase !== 'loading' ? session.current.compute(graph.nodes, goal) : null),
    [graph, saved, phase, goal],
  );
  useEffect(() => {
    if (!graph || !slots) return;
    const merged = session.current.pendingSave(slots);
    if (!shouldSave({ ...load, dirty: merged !== null }) || !merged) return;
    const timer = setTimeout(() => {
      api.saveLayout(merged).then(
        () => session.current.saved(merged),
        (err: unknown) => console.warn('layout save failed', err),
      );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [slots, load, graph, api]);
  return slots;
}
