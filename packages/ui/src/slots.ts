import type { PublicGraph } from '@mapskill/core/client';
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

/** Slots for every part: saved ones from .mapskill/layout.json, new ones assigned and saved after a quiet second. */
export function useSlots(graph: PublicGraph | null, api: Api): Record<string, number> {
  const [saved, setSaved] = useState<Record<string, number> | null>(null);
  // Everything persisted so far (server file plus saves this session), including parts that are gone for now.
  const lastSaved = useRef<Record<string, number>>({});
  useEffect(() => {
    api.layout().then(
      (l) => {
        lastSaved.current = { ...l.slots, ...lastSaved.current };
        setSaved(l.slots);
      },
      () => setSaved({}),
    );
  }, [api]);
  const slots = useMemo(
    () => (graph ? assignSlots(graph.nodes, { ...(saved ?? {}), ...lastSaved.current }) : {}),
    [graph, saved],
  );
  useEffect(() => {
    if (saved === null || !graph) return;
    if (Object.entries(slots).every(([id, slot]) => lastSaved.current[id] === slot)) return;
    const timer = setTimeout(() => {
      const merged = mergeForSave(lastSaved.current, slots);
      lastSaved.current = merged;
      api.saveLayout(merged).catch(() => {});
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [slots, saved, graph, api]);
  return slots;
}
