import type { PublicGraph } from '../graph/delta';
import type { GoalItemStatus, GoalStatus, GoalSummary } from '../model/protocol';
import type { MapEdge, MapNode } from '../model/types';
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

interface Ctx {
  graph: PublicGraph;
  out: Map<string, MapEdge[]>;
  reachCache: Map<string, Set<string>>;
}

function makeCtx(graph: PublicGraph): Ctx {
  const out = new Map<string, MapEdge[]>();
  for (const e of graph.edges) {
    const list = out.get(e.from);
    if (list) list.push(e);
    else out.set(e.from, [e]);
  }
  return { graph, out, reachCache: new Map() };
}

/** The node plus every node it reaches over `uses` and `calls-api` edges in at most MAX_STEPS steps. */
function reach(ctx: Ctx, start: string): Set<string> {
  const cached = ctx.reachCache.get(start);
  if (cached) return cached;
  const seen = new Set([start]);
  let frontier = [start];
  for (let step = 0; step < MAX_STEPS && frontier.length > 0; step++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of ctx.out.get(id) ?? []) {
        if ((e.kind === 'uses' || e.kind === 'calls-api') && !seen.has(e.to)) {
          seen.add(e.to);
          next.push(e.to);
        }
      }
    }
    frontier = next;
  }
  ctx.reachCache.set(start, seen);
  return seen;
}

/** A filter with its regexes compiled once. `bad` means a regex was invalid, so nothing matches. */
interface Compiled {
  f: NodeFilter;
  route?: RegExp;
  name?: RegExp;
  table?: RegExp;
  bad: boolean;
}

function compile(f: NodeFilter): Compiled {
  const c: Compiled = { f, bad: false };
  for (const [key, src] of [['route', f.routeMatches], ['name', f.nameMatches], ['table', f.touchesTable]] as const) {
    if (src === undefined) continue;
    const r = regex(src);
    if (r) c[key] = r;
    else c.bad = true;
  }
  return c;
}

function matches(ctx: Ctx, n: MapNode, c: Compiled): boolean {
  const f = c.f;
  if (n.planned || c.bad) return false;
  if (f.type && n.type !== f.type) return false;
  if (c.route && (n.route === undefined || !c.route.test(n.route))) return false;
  if (c.name && !c.name.test(n.label)) return false;
  if (f.talksTo !== undefined || c.table) {
    const edges: MapEdge[] = [];
    for (const id of reach(ctx, n.id)) edges.push(...(ctx.out.get(id) ?? []));
    if (f.talksTo !== undefined && !edges.some((e) => e.kind === 'talks-to' && e.to === `service:${f.talksTo}`)) return false;
    const table = c.table;
    if (table && !edges.some((e) => (e.kind === 'reads' || e.kind === 'writes') && e.to.startsWith('table:') && table.test(e.to.slice('table:'.length)))) return false;
  }
  return true;
}

/** Ids of the table nodes the node reaches (see `reach`) whose name matches the filter's touchesTable. */
function touchedTables(ctx: Ctx, n: MapNode, table: RegExp): string[] {
  const ids = new Set<string>();
  for (const id of reach(ctx, n.id)) {
    for (const e of ctx.out.get(id) ?? []) {
      if ((e.kind === 'reads' || e.kind === 'writes') && e.to.startsWith('table:') && table.test(e.to.slice('table:'.length))) ids.add(e.to);
    }
  }
  return [...ids];
}

/** Result of one check, and the nodes of the first anyNode that was true. */
function run(ctx: Ctx, c: GoalCheck, fileExists: (rel: string) => boolean): { ok: boolean; nodes: string[] } {
  if ('fileExists' in c) return { ok: fileExists(c.fileExists), nodes: [] };
  if ('noFindings' in c) return { ok: !ctx.graph.findings.some((f) => f.kind === c.noFindings), nodes: [] };
  if ('anyNode' in c) {
    const compiled = compile(c.anyNode);
    const matched = ctx.graph.nodes.filter((n) => matches(ctx, n, compiled));
    const hits = matched.map((n) => n.id).sort();
    // A table item is satisfied by the table itself, so the tables come first and become the heirs of the ghost.
    const table = compiled.table;
    const tables = table ? [...new Set(matched.flatMap((n) => touchedTables(ctx, n, table)))].sort() : [];
    return { ok: hits.length > 0, nodes: [...tables, ...hits].slice(0, MAX_MATCHES) };
  }
  if ('all' in c) {
    let nodes: string[] = [];
    for (const sub of c.all) {
      const r = run(ctx, sub, fileExists);
      if (!r.ok) return { ok: false, nodes: [] };
      if (nodes.length === 0) nodes = r.nodes;
    }
    return { ok: true, nodes };
  }
  for (const sub of c.any) {
    const r = run(ctx, sub, fileExists);
    if (r.ok) return r;
  }
  return { ok: false, nodes: [] };
}

export function evaluateGoal(template: GoalTemplate, graph: PublicGraph, fileExists: (rel: string) => boolean): GoalStatus {
  const ctx = makeCtx(graph);
  const items: GoalItemStatus[] = template.items.map((i) => {
    const r = run(ctx, i.check, fileExists);
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
