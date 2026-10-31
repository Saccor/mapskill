import type { PublicGraph, Zone } from '@mapskill/core/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Api } from './api';
import { assignSlots } from './layout';

const SAVE_DELAY_MS = 1000;
const MAX_SAVED = 20_000;

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

/** Slots for every part: saved ones from .mapskill/layout.json, new ones assigned and saved after a quiet second. */
export function useSlots(graph: PublicGraph | null, api: Api): Record<string, number> {
  const [saved, setSaved] = useState<Record<string, number> | null>(null);
  // Everything persisted so far (server file plus saves this session), including parts that are gone for now.
  const lastSaved = useRef<Record<string, number>>({});
  const prevSlots = useRef<Record<string, number>>({});
  // When the layout could not be read, never save: that would overwrite the file with a partial layout.
  const loadFailed = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = (again: boolean) =>
      api.layout().then(
        (l) => {
          if (cancelled) return;
          loadFailed.current = false;
          lastSaved.current = { ...l.slots, ...lastSaved.current };
          setSaved(l.slots);
        },
        () => {
          if (cancelled) return;
          loadFailed.current = true;
          setSaved((s) => s ?? {});
          if (again) retry = setTimeout(() => void load(false), 2000);
        },
      );
    void load(true);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [api]);
  const slots = useMemo(
    () =>
      graph
        ? assignSlots(graph.nodes, restorableSlots(prevSlots.current, { ...(saved ?? {}), ...lastSaved.current }, graph.nodes))
        : {},
    [graph, saved],
  );
  useEffect(() => {
    prevSlots.current = slots;
  }, [slots]);
  useEffect(() => {
    if (saved === null || !graph || loadFailed.current) return;
    if (Object.entries(slots).every(([id, slot]) => lastSaved.current[id] === slot)) return;
    const timer = setTimeout(() => {
      if (loadFailed.current) return;
      const merged = mergeForSave(lastSaved.current, slots);
      lastSaved.current = merged;
      api.saveLayout(merged).catch(() => {});
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [slots, saved, graph, api]);
  return slots;
}
