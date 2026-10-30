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

export function scanProject(root: string): Graph {
  const framework: Framework = isNextProject(root) ? 'nextjs' : 'generic';
  const files: Record<string, FileFacts> = {};
  for (const rel of listSourceFiles(root)) {
    const abs = path.join(root, rel);
    files[rel] = extractFacts(rel, fs.readFileSync(abs, 'utf8'), fs.statSync(abs).mtimeMs);
  }

  const resolver = createResolver(root);
  const cache = new Map<string, string | null>();
  const resolve = (specifier: string, from: string): string | null => {
    const key = `${from}\u0000${specifier}`;
    if (!cache.has(key)) cache.set(key, resolver.resolve(specifier, from));
    return cache.get(key) ?? null;
  };

  const links: FileLink[] = [];
  for (const f of Object.values(files)) {
    for (const imp of f.imports) {
      const to = resolve(imp.specifier, f.path);
      if (to && files[to]) links.push({ from: f.path, to, names: imp.bindings.map((b) => b.imported), typeOnly: imp.typeOnly });
    }
  }

  const model = buildModel({ files, resolve, prismaModels: readPrismaModels(root), framework });
  const findings = runAnalyzers({ files, links, nodes: model.nodes, owner: model.owner, framework });
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
