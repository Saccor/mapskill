import fs from 'node:fs';
import path from 'node:path';
import { buildModel } from '../adapters/build-model';
import { isNextProject, readPrismaModels } from '../adapters/nextjs/project';
import { computeHealth } from '../analyze/health';
import { runAnalyzers } from '../analyze/index';
import type { FileFacts, FileLink, Framework, Graph } from '../model/types';
import { extractFacts } from '../parse/extract';
import { createResolver } from '../resolve/resolver';
import { listSourceFiles } from '../scan/files';

const MAX_FILE_BYTES = 1_000_000;
const ASSET_SPECIFIER = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|json|md|mdx|txt|woff2?|ttf|otf|mp4|webm|pdf)$/i;

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

export function scanProject(root: string): Graph {
  const framework: Framework = isNextProject(root) ? 'nextjs' : 'generic';
  const files: Record<string, FileFacts> = {};
  let skippedFile = false;
  for (const rel of listSourceFiles(root)) {
    const abs = path.join(root, rel);
    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE_BYTES) {
        skippedFile = true;
        continue;
      }
      files[rel] = extractFacts(rel, fs.readFileSync(abs, 'utf8'), stat.mtimeMs);
    } catch {
      skippedFile = true; // unreadable file: skip it
    }
  }

  const resolver = createResolver(root);
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

  const model = buildModel({ files, resolve, prismaModels: readPrismaModels(root), framework });
  const hasAppDir = ['app', 'src/app', 'pages', 'src/pages'].some((d) => fs.existsSync(path.join(root, d)));
  const degraded = skippedFile || unresolvedLocal || Boolean(resolver.configError) || (framework === 'generic' && hasAppDir);
  const findings = runAnalyzers({
    files,
    links,
    nodes: model.nodes,
    owner: model.owner,
    framework,
    nestedPackageDirs: nestedPackageDirsOf(root, Object.keys(files)),
    degraded,
    shadcn: fs.existsSync(path.join(root, 'components.json')),
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
