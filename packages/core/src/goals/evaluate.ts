import type { PublicGraph } from '../graph/delta';
import type { GoalItemStatus, GoalStatus, GoalSummary } from '../model/protocol';
import type { MapNode } from '../model/types';
import { ZONE_OF_TYPE } from '../model/zones';
import { BUILTIN_GOALS } from './builtin';
import type { GoalCheck, GoalItem, GoalTemplate, NodeFilter } from './types';

const MAX_STEPS = 3;
const MAX_MATCHES = 5;

export function goalSummaries(templates: GoalTemplate[] = BUILTIN_GOALS): GoalSummary[] {
  return templates.map((t) => ({ id: t.id, title: t.title, description: t.description }));
}

/** The template with its `extends` chain resolved: parent items first, a child item with the same id replaces it in place. */
export function findGoal(id: string, templates: GoalTemplate[] = BUILTIN_GOALS, seen: string[] = []): GoalTemplate | null {
  if (seen.includes(id)) throw new Error(`goal extends cycle: ${[...seen, id].join(' -> ')}`);
  const t = templates.find((x) => x.id === id);
  if (!t) return null;
  if (!t.extends) return t;
  const parent = findGoal(t.extends, templates, [...seen, id]);
  if (!parent) return t;
  const items: GoalItem[] = parent.items.map((p) => t.items.find((c) => c.id === p.id) ?? p);
  for (const c of t.items) if (!items.some((i) => i.id === c.id)) items.push(c);
  return { ...t, items };
}

function regex(source: string): RegExp | null {
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

/** The node plus every node it reaches over `uses` edges in at most MAX_STEPS steps. */
function reach(graph: PublicGraph, start: string): Set<string> {
  const out = new Set([start]);
  let frontier = [start];
  for (let step = 0; step < MAX_STEPS && frontier.length > 0; step++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of graph.edges) {
        if (e.from === id && e.kind === 'uses' && !out.has(e.to)) {
          out.add(e.to);
          next.push(e.to);
        }
      }
    }
    frontier = next;
  }
  return out;
}

function matches(graph: PublicGraph, n: MapNode, f: NodeFilter): boolean {
  if (n.planned) return false;
  if (f.type && n.type !== f.type) return false;
  if (f.routeMatches !== undefined) {
    const r = regex(f.routeMatches);
    if (!r || n.route === undefined || !r.test(n.route)) return false;
  }
  if (f.nameMatches !== undefined) {
    const r = regex(f.nameMatches);
    if (!r || !r.test(n.label)) return false;
  }
  if (f.talksTo !== undefined || f.touchesTable !== undefined) {
    const nodes = reach(graph, n.id);
    const from = graph.edges.filter((e) => nodes.has(e.from));
    if (f.talksTo !== undefined && !from.some((e) => e.kind === 'talks-to' && e.to === `service:${f.talksTo}`)) return false;
    if (f.touchesTable !== undefined) {
      const r = regex(f.touchesTable);
      const hit = (e: { kind: string; to: string }) =>
        (e.kind === 'reads' || e.kind === 'writes') && e.to.startsWith('table:') && r !== null && r.test(e.to.slice('table:'.length));
      if (!from.some(hit)) return false;
    }
  }
  return true;
}

/** Result of one check, and the nodes of the first anyNode that was true. */
function run(graph: PublicGraph, c: GoalCheck, fileExists: (rel: string) => boolean): { ok: boolean; nodes: string[] } {
  if ('fileExists' in c) return { ok: fileExists(c.fileExists), nodes: [] };
  if ('noFindings' in c) return { ok: !graph.findings.some((f) => f.kind === c.noFindings), nodes: [] };
  if ('anyNode' in c) {
    const hits = graph.nodes.filter((n) => matches(graph, n, c.anyNode)).map((n) => n.id).sort();
    return { ok: hits.length > 0, nodes: hits.slice(0, MAX_MATCHES) };
  }
  if ('all' in c) {
    let nodes: string[] = [];
    for (const sub of c.all) {
      const r = run(graph, sub, fileExists);
      if (!r.ok) return { ok: false, nodes: [] };
      if (nodes.length === 0) nodes = r.nodes;
    }
    return { ok: true, nodes };
  }
  for (const sub of c.any) {
    const r = run(graph, sub, fileExists);
    if (r.ok) return r;
  }
  return { ok: false, nodes: [] };
}

export function evaluateGoal(template: GoalTemplate, graph: PublicGraph, fileExists: (rel: string) => boolean): GoalStatus {
  const items: GoalItemStatus[] = template.items.map((i) => {
    const r = run(graph, i.check, fileExists);
    return {
      id: i.id,
      title: i.title,
      why: i.why,
      done: r.ok,
      ...(i.nodeType ? { nodeType: i.nodeType, zone: ZONE_OF_TYPE[i.nodeType] } : {}),
      ...(i.suggest ? { suggestPath: i.suggest.path } : {}),
      matchedNodeIds: r.ok ? r.nodes : [],
    };
  });
  return { goalId: template.id, title: template.title, items, done: items.filter((i) => i.done).length, total: items.length };
}
