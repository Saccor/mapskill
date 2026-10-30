import fs from 'node:fs';
import path from 'node:path';
import { buildModel } from '../adapters/build-model';
import { isNextProject, readPrismaModels } from '../adapters/nextjs/project';
import { computeHealth } from '../analyze/health';
import { runAnalyzers } from '../analyze/index';
import type { FileFacts, FileLink, Framework, Graph } from '../model/types';
import { extractFacts } from '../parse/extract';
import { createResolver, type Resolver } from '../resolve/resolver';
import { listSourceFiles } from '../scan/files';
import { sha1 } from '../util/hash';

export const MAX_FILE_BYTES = 1_000_000;
const ASSET_SPECIFIER = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|json|md|mdx|txt|woff2?|ttf|otf|mp4|webm|pdf)$/i;

/** Everything Mapskill knows about one project. `facts` and `skipped` change as files change; the rest is read once per load. */
export interface Project {
  root: string;
  framework: Framework;
  resolver: Resolver;
  prismaModels: string[];
  shadcn: boolean;
  /** Facts per project-relative source file. */
  facts: Record<string, FileFacts>;
  /** Source files that exist but were not read (too large or unreadable). */
  skipped: Set<string>;
  graph: Graph;
}

export type ReadResult = FileFacts | 'missing' | 'skipped';

/** Reads one source file. Reuses `previous` when the content hash is unchanged (only the mtime is refreshed). */
export function readSourceFile(root: string, rel: string, previous?: FileFacts): ReadResult {
  const abs = path.join(root, rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'skipped';
  }
  if (!stat.isFile()) return 'missing';
  if (stat.size > MAX_FILE_BYTES) return 'skipped';
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return 'skipped';
  }
  if (previous && previous.hash === sha1(text)) return { ...previous, mtimeMs: stat.mtimeMs };
  return extractFacts(rel, text, stat.mtimeMs);
}

/** Records a read result. Returns true when a file appeared on disk or disappeared from it. */
export function storeRead(project: Project, rel: string, result: ReadResult): boolean {
  const known = rel in project.facts || project.skipped.has(rel);
  delete project.facts[rel];
  project.skipped.delete(rel);
  if (result === 'missing') return known;
  if (result === 'skipped') project.skipped.add(rel);
  else project.facts[rel] = result;
  return !known;
}

export function loadProject(root: string, cached: Record<string, FileFacts> = {}): Project {
  const project: Project = {
    root,
    framework: isNextProject(root) ? 'nextjs' : 'generic',
    resolver: createResolver(root),
    prismaModels: readPrismaModels(root),
    shadcn: fs.existsSync(path.join(root, 'components.json')),
    facts: {},
    skipped: new Set(),
    graph: undefined as unknown as Graph,
  };
  for (const rel of listSourceFiles(root)) storeRead(project, rel, readSourceFile(root, rel, cached[rel]));
  project.graph = buildGraph(project);
  return project;
}

function nestedPackageDirsOf(root: string, paths: string[]): string[] {
  const checked = new Map<string, boolean>();
  const hasPackage = (dir: string): boolean => {
    if (!checked.has(dir)) checked.set(dir, fs.existsSync(path.join(root, dir, 'package.json')));
    return checked.get(dir)!;
  };
  const out = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (hasPackage(dir)) out.add(dir);
    }
  }
  return [...out].sort();
}

/** Derives links, nodes, edges, findings and health from the current facts. Files are processed in sorted order, so the result does not depend on insertion order. */
export function buildGraph(project: Project): Graph {
  const { root, framework, resolver } = project;
  const files: Record<string, FileFacts> = {};
  for (const rel of Object.keys(project.facts).sort()) files[rel] = project.facts[rel];

  const cache = new Map<string, string | null>();
  const resolve = (specifier: string, from: string): string | null => {
    const key = `${from}\u0000${specifier}`;
    if (!cache.has(key)) cache.set(key, resolver.resolve(specifier, from));
    return cache.get(key) ?? null;
  };

  const isLocalSpecifier = (spec: string): boolean =>
    /^(\.{1,2}\/|@\/|~\/)/.test(spec) || resolver.pathPrefixes.some((p) => spec.startsWith(p));
  let unresolvedLocal = false;
  const links: FileLink[] = [];
  for (const f of Object.values(files)) {
    for (const imp of f.imports) {
      const to = resolve(imp.specifier, f.path);
      if (!to && isLocalSpecifier(imp.specifier) && !ASSET_SPECIFIER.test(imp.specifier)) unresolvedLocal = true;
      if (to && files[to]) links.push({ from: f.path, to, names: imp.bindings.map((b) => b.imported), typeOnly: imp.typeOnly });
    }
  }

  const model = buildModel({ files, resolve, prismaModels: project.prismaModels, framework });
  const hasAppDir = ['app', 'src/app', 'pages', 'src/pages'].some((d) => fs.existsSync(path.join(root, d)));
  const degraded =
    project.skipped.size > 0 || unresolvedLocal || Boolean(resolver.configError) || (framework === 'generic' && hasAppDir);
  const findings = runAnalyzers({
    files,
    links,
    nodes: model.nodes,
    owner: model.owner,
    framework,
    nestedPackageDirs: nestedPackageDirsOf(root, Object.keys(files)),
    degraded,
    shadcn: project.shadcn,
  });
  return {
    root,
    framework,
    files,
    links,
    nodes: model.nodes,
    edges: model.edges,
    findings,
    health: computeHealth(model.nodes, findings),
  };
}
