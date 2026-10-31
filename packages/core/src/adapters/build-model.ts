import path from 'node:path';
import type { EdgeKind, FileFacts, Framework, MapEdge, MapNode, NodeType } from '../model/types';
import { ZONE_OF_TYPE } from '../model/zones';
import { isTestFile, isToolingConfig } from './file-kinds';
import { routeFileInfo, routeMatches } from './nextjs/routes';
import { serviceForSpecifier } from './nextjs/services';

export type ResolveFn = (specifier: string, fromFile: string) => string | null;

export interface ModelInput {
  files: Record<string, FileFacts>;
  resolve: ResolveFn;
  prismaModels: string[];
  framework: Framework;
}

export interface Model {
  nodes: MapNode[];
  edges: MapEdge[];
  owner: (file: string, fn?: string) => string | undefined;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function buildModel(input: ModelInput): Model {
  const nodes: MapNode[] = [];
  const byId = new Map<string, MapNode>();
  const byFile = new Map<string, string[]>();
  const fnOwner = new Map<string, string>();

  const add = (n: Omit<MapNode, 'zone'>): string => {
    if (!byId.has(n.id)) {
      const full: MapNode = { ...n, zone: ZONE_OF_TYPE[n.type] };
      nodes.push(full);
      byId.set(n.id, full);
    }
    if (n.file) {
      const list = byFile.get(n.file) ?? [];
      if (!list.includes(n.id)) list.push(n.id);
      byFile.set(n.file, list);
    }
    return n.id;
  };

  for (const f of Object.values(input.files)) {
    const file = f.path;
    if (isToolingConfig(file)) continue;
    const base = path.posix.basename(file).replace(/\.[^.]+$/, '');
    const info = input.framework === 'nextjs' ? routeFileInfo(file) : null;
    let fileNode: string | undefined;
    if (isTestFile(file)) {
      fileNode = add({ id: `test:${file}`, type: 'test', label: base, file });
    } else if (info) {
      if (info.kind === 'page' || info.kind === 'pages-page') {
        fileNode = add({ id: `page:${file}`, type: 'page', label: info.route, route: info.route, file });
      } else if (info.kind === 'route' || info.kind === 'pages-api') {
        const methods = info.kind === 'pages-api' ? [] : f.exports.map((e) => e.name).filter((n) => HTTP_METHODS.includes(n));
        const label = `${methods.length ? methods.join(',') : 'ALL'} ${info.route}`;
        fileNode = add({ id: `api-route:${file}`, type: 'api-route', label, route: info.route, file });
      } else if (info.kind === 'middleware') {
        fileNode = add({ id: `config:${file}`, type: 'config', label: 'middleware', file });
      } else {
        fileNode = add({ id: `layout:${file}`, type: 'layout', label: `${info.kind} ${info.route}`, route: info.route, file });
      }
    }
    if (fileNode) {
      for (const fn of f.functions) fnOwner.set(`${file}#${fn.name}`, fileNode);
      continue;
    }
    const serverFile = f.directives.includes('use server');
    for (const fn of f.functions) {
      if (!fn.exportName) continue;
      const type: NodeType = serverFile ? 'server-action' : fn.returnsJsx ? 'component' : 'helper';
      const label = fn.name === 'default' ? base : fn.name;
      const id = add({ id: `${type}:${file}#${fn.name}`, type, label, file, startLine: fn.startLine, endLine: fn.endLine });
      fnOwner.set(`${file}#${fn.name}`, id);
    }
    if (!byFile.has(file)) add({ id: `file:${file}`, type: 'file', label: base, file });
  }

  for (const m of input.prismaModels) add({ id: `table:${m}`, type: 'table', label: m });
  for (const f of Object.values(input.files)) {
    for (const c of f.calls) if (c.kind === 'table') add({ id: `table:${c.value}`, type: 'table', label: c.value });
  }

  const owner = (file: string, fn?: string): string | undefined =>
    (fn ? fnOwner.get(`${file}#${fn}`) : undefined) ?? byFile.get(file)?.[0];

  const edges: MapEdge[] = [];
  const seen = new Set<string>();
  const link = (from: string | undefined, to: string | undefined, kind: EdgeKind): void => {
    if (!from || !to || from === to) return;
    const id = `${kind}:${from}->${to}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, from, to, kind });
  };
  const sourcesFor = (f: FileFacts, local: string): string[] => {
    const fromFunctions = f.functions
      .filter((fn) => fn.refs.includes(local))
      .map((fn) => owner(f.path, fn.name))
      .filter((x): x is string => Boolean(x));
    if (fromFunctions.length) return [...new Set(fromFunctions)];
    const primary = owner(f.path);
    return primary ? [primary] : [];
  };
  const exportNode = (target: string, name: string, visited = new Set<string>()): string | undefined => {
    const key = `${target}#${name}`;
    if (visited.has(key)) return undefined;
    visited.add(key);
    const facts = input.files[target];
    const fn = facts?.functions.find((x) => x.exportName === name);
    if (fn) return owner(target, fn.name);
    if (facts) {
      for (const imp of facts.imports) {
        const binding = imp.bindings.find((x) => x.local === name && x.imported !== '*');
        if (!binding) continue;
        const next = input.resolve(imp.specifier, target);
        const hit = next ? exportNode(next, binding.imported, visited) : undefined;
        if (hit) return hit;
      }
      for (const imp of facts.imports) {
        if (!imp.bindings.some((x) => x.imported === '*' && x.local === '*')) continue;
        const next = input.resolve(imp.specifier, target);
        const hit = next ? exportNode(next, name, visited) : undefined;
        if (hit) return hit;
      }
    }
    const list = byFile.get(target) ?? [];
    const only = list.length === 1 ? byId.get(list[0]) : undefined;
    return only && only.startLine === undefined ? only.id : undefined;
  };

  for (const f of Object.values(input.files)) {
    if (!byFile.has(f.path)) continue;
    const testFile = isTestFile(f.path);
    for (const imp of f.imports) {
      if (imp.typeOnly) continue;
      const target = input.resolve(imp.specifier, f.path);
      const service = target ? null : serviceForSpecifier(imp.specifier);
      if (service) add({ id: `service:${service.id}`, type: 'service', label: service.label });
      for (const b of imp.bindings) {
        let targets: string[] = [];
        if (target && byFile.has(target)) {
          targets = b.imported === '*' ? (byFile.get(target) ?? []) : [exportNode(target, b.imported)].filter((x): x is string => Boolean(x));
        } else if (service) {
          targets = [`service:${service.id}`];
        }
        const primary = owner(f.path);
        const sources = b.local === '*' ? (primary ? [primary] : []) : sourcesFor(f, b.local);
        const kind: EdgeKind = testFile ? 'tests' : service ? 'talks-to' : 'uses';
        for (const s of sources) for (const t of targets) link(s, t, kind);
      }
    }
    for (const c of f.calls) {
      const src = owner(f.path, c.inFunction);
      if (c.kind === 'table') link(src, `table:${c.value}`, c.op === 'write' ? 'writes' : 'reads');
      if (c.kind === 'fetch') {
        for (const n of nodes) if (n.type === 'api-route' && n.route && routeMatches(n.route, c.value)) link(src, n.id, 'calls-api');
      }
    }
  }

  return { nodes, edges, owner };
}
