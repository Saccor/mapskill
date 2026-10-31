import type { GoalItemStatus, GoalStatus, MapNode, PublicGraph } from '@mapskill/core/client';
import { t, type Lang } from './i18n';

export const GHOST_PREFIX = 'ghost:';
const MAX_REUSE = 3;

export function ghostNodes(status: GoalStatus | null, lang: Lang): MapNode[] {
  if (!status) return [];
  return status.items
    .filter((i) => !i.done && i.nodeType && i.zone)
    .map((i) => ({ id: `${GHOST_PREFIX}${i.id}`, type: i.nodeType!, zone: i.zone!, label: i.title[lang], planned: true }));
}

/** The graph the map shows: real parts plus the goal's missing parts as planned ghosts. */
export function withGhosts(graph: PublicGraph, status: GoalStatus | null, lang: Lang): PublicGraph {
  const ghosts = ghostNodes(status, lang);
  return ghosts.length === 0 ? graph : { ...graph, nodes: [...graph.nodes, ...ghosts] };
}

export function ghostItem(status: GoalStatus | null, nodeId: string): GoalItemStatus | null {
  if (!status || !nodeId.startsWith(GHOST_PREFIX)) return null;
  return status.items.find((i) => i.id === nodeId.slice(GHOST_PREFIX.length)) ?? null;
}

export function goalLine(status: GoalStatus, lang: Lang): string {
  return t(lang, 'goalLine', { title: status.title[lang], done: status.done, total: status.total });
}

export function buildText(item: GoalItemStatus, graph: PublicGraph, lang: Lang): string {
  const parts = [t(lang, 'buildSentence', { title: item.title[lang], why: item.why[lang].replace(/\.\s*$/, '') })];
  if (item.suggestPath) parts.push(t(lang, 'placeSentence', { path: item.suggestPath }));
  const reuse = graph.nodes
    .filter((n) => !n.planned && n.type === item.nodeType && n.zone === item.zone)
    .map((n) => n.label)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_REUSE);
  if (reuse.length > 0) parts.push(t(lang, 'reuseSentence', { list: reuse.join(', ') }));
  return parts.join(' ');
}
