import type { Finding, MapEdge, MapNode, PublicGraph } from '@mapskill/core/client';
import { t, type Lang } from './i18n';
import type { Activity, MapState } from './reducer';

const byLabel = (a: MapNode, b: MapNode): number => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

export function findingsByNode(graph: PublicGraph): Record<string, Finding[]> {
  const out: Record<string, Finding[]> = {};
  for (const f of graph.findings) for (const id of f.nodeIds) (out[id] ??= []).push(f);
  return out;
}

export type PartFlags = { pulsing: boolean; touched: boolean; locked: boolean; unreadable: boolean };

export function partFlags(
  graph: PublicGraph,
  s: Pick<MapState, 'pulseUntil' | 'touchedThisTurn' | 'lockedFiles'>,
  now: number,
): Record<string, PartFlags> {
  const touched = new Set(s.touchedThisTurn);
  const locked = new Set(s.lockedFiles);
  const unreadable = new Set(graph.unreadableFiles);
  const out: Record<string, PartFlags> = {};
  for (const n of graph.nodes) {
    const f = n.file;
    out[n.id] = {
      pulsing: f !== undefined && (s.pulseUntil[f] ?? 0) > now,
      touched: f !== undefined && touched.has(f),
      locked: f !== undefined && locked.has(f),
      unreadable: f !== undefined && unreadable.has(f),
    };
  }
  return out;
}

/** When the next pulse ends (to re-render then), or null when nothing pulses. */
export function nextPulseEnd(pulseUntil: Record<string, number>, now: number): number | null {
  const future = Object.values(pulseUntil).filter((until) => until > now);
  return future.length ? Math.min(...future) : null;
}

export function visibleEdges(graph: PublicGraph, selectedId: string | null, showAll: boolean): MapEdge[] {
  if (showAll) return graph.edges;
  if (!selectedId) return [];
  return graph.edges.filter((e) => e.from === selectedId || e.to === selectedId);
}

export function related(graph: PublicGraph, id: string): { usedBy: MapNode[]; uses: MapNode[] } {
  const node = (nid: string): MapNode | undefined => graph.nodes.find((n) => n.id === nid);
  const unique = (ids: string[]): MapNode[] =>
    [...new Set(ids)].map(node).filter((n): n is MapNode => n !== undefined).sort(byLabel);
  return {
    usedBy: unique(graph.edges.filter((e) => e.to === id && (e.kind === 'uses' || e.kind === 'tests')).map((e) => e.from)),
    uses: unique(graph.edges.filter((e) => e.from === id).map((e) => e.to)),
  };
}

export function projectHealth(graph: PublicGraph): number {
  if (graph.nodes.length === 0) return 10;
  const sum = graph.nodes.reduce((s, n) => s + (graph.health[n.id] ?? 10), 0);
  return Math.round(sum / graph.nodes.length);
}

export function activityLine(a: Activity, graph: PublicGraph | null, lang: Lang): string {
  if (a.files.length === 0) return t(lang, 'activityNone');
  const name = (file: string): string => graph?.nodes.find((n) => n.file === file)?.label ?? file.split('/').pop() ?? file;
  const names = [...new Set(a.files.map((f) => name(f.path)))];
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
  const who = a.files.some((f) => f.by === 'claude') ? t(lang, 'byClaude') : t(lang, 'byYou');
  return t(lang, 'activityLine', { who, files: shown });
}

/** The header line for files the scan could not read (at most three names), or null when there are none. */
export function unreadableLine(graph: PublicGraph, lang: Lang): string | null {
  const files = graph.unreadableFiles;
  if (files.length === 0) return null;
  const shown = files.slice(0, 3).join(', ') + (files.length > 3 ? ` +${files.length - 3}` : '');
  return t(lang, 'unreadable', { files: shown });
}
