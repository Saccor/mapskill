import type { Finding, Framework, Graph, MapEdge, MapNode } from '../model/types';

/** The graph as clients see it: no per-file facts or file links. */
export interface PublicGraph {
  root: string;
  framework: Framework;
  nodes: MapNode[];
  edges: MapEdge[];
  findings: Finding[];
  health: Record<string, number>;
  fileCount: number;
  /** Files whose latest content could not be parsed, sorted. */
  unreadableFiles: string[];
}

export interface GraphDelta {
  addedNodes: MapNode[];
  removedNodeIds: string[];
  changedNodes: MapNode[];
  addedEdges: MapEdge[];
  removedEdgeIds: string[];
  addedFindings: Finding[];
  resolvedFindingIds: string[];
  changedFindings: Finding[];
  framework: Framework;
  health: Record<string, number>;
  fileCount: number;
  unreadableFiles: string[];
}

export function toPublicGraph(g: Graph): PublicGraph {
  return {
    root: g.root,
    framework: g.framework,
    nodes: g.nodes,
    edges: g.edges,
    findings: g.findings,
    health: g.health,
    fileCount: Object.keys(g.files).length,
    unreadableFiles: Object.values(g.files)
      .filter((f) => f.parseError)
      .map((f) => f.path)
      .sort(),
  };
}

interface Diff<T> {
  added: T[];
  removed: string[];
  changed: T[];
}

function diffById<T extends { id: string }>(before: T[], after: T[]): Diff<T> {
  const old = new Map(before.map((x) => [x.id, x]));
  const seen = new Set<string>();
  const added: T[] = [];
  const changed: T[] = [];
  for (const x of after) {
    seen.add(x.id);
    const prev = old.get(x.id);
    if (!prev) added.push(x);
    else if (JSON.stringify(prev) !== JSON.stringify(x)) changed.push(x);
  }
  return { added, removed: before.filter((x) => !seen.has(x.id)).map((x) => x.id), changed };
}

export function diffGraphs(before: PublicGraph, after: PublicGraph): GraphDelta {
  const n = diffById(before.nodes, after.nodes);
  const e = diffById(before.edges, after.edges);
  const f = diffById(before.findings, after.findings);
  return {
    addedNodes: n.added,
    removedNodeIds: n.removed,
    changedNodes: n.changed,
    addedEdges: [...e.added, ...e.changed],
    removedEdgeIds: [...e.removed, ...e.changed.map((x) => x.id)],
    addedFindings: f.added,
    resolvedFindingIds: f.removed,
    changedFindings: f.changed,
    framework: after.framework,
    health: after.health,
    fileCount: after.fileCount,
    unreadableFiles: after.unreadableFiles,
  };
}

export function isEmptyDelta(d: GraphDelta, before: PublicGraph): boolean {
  const lists = [
    d.addedNodes, d.removedNodeIds, d.changedNodes, d.addedEdges, d.removedEdgeIds,
    d.addedFindings, d.resolvedFindingIds, d.changedFindings,
  ];
  return (
    lists.every((l) => l.length === 0) &&
    d.framework === before.framework &&
    d.fileCount === before.fileCount &&
    d.unreadableFiles.join('\n') === before.unreadableFiles.join('\n') &&
    JSON.stringify(d.health) === JSON.stringify(before.health)
  );
}

function patch<T extends { id: string }>(list: T[], removed: string[], changed: T[], added: T[]): T[] {
  const gone = new Set(removed);
  const replacement = new Map(changed.map((x) => [x.id, x]));
  return [...list.filter((x) => !gone.has(x.id)).map((x) => replacement.get(x.id) ?? x), ...added];
}

/** Applies a delta to a graph. Kept items stay in place, added items are appended. */
export function applyDelta(g: PublicGraph, d: GraphDelta): PublicGraph {
  return {
    ...g,
    framework: d.framework,
    health: d.health,
    fileCount: d.fileCount,
    unreadableFiles: d.unreadableFiles,
    nodes: patch(g.nodes, d.removedNodeIds, d.changedNodes, d.addedNodes),
    edges: patch(g.edges, d.removedEdgeIds, [], d.addedEdges),
    findings: patch(g.findings, d.resolvedFindingIds, d.changedFindings, d.addedFindings),
  };
}
