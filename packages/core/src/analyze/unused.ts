import { isTestFile, isToolingConfig } from '../adapters/file-kinds';
import { routeFileInfo } from '../adapters/nextjs/routes';
import type { Finding, Framework } from '../model/types';
import { msg } from '../text/messages';
import { makeFinding, type AnalysisContext } from './context';

const FRAMEWORK_EXPORTS = new Set([
  'default', 'metadata', 'generateMetadata', 'generateStaticParams', 'generateViewport', 'viewport',
  'revalidate', 'dynamic', 'dynamicParams', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  'config', 'middleware', 'getServerSideProps', 'getStaticProps', 'getStaticPaths',
]);

export function isEntryFile(file: string, framework: Framework): boolean {
  if (isTestFile(file) || !file.includes('/') || file.startsWith('scripts/') || file.startsWith('prisma/')) return true;
  if (framework === 'nextjs') return routeFileInfo(file) !== null || /^(src\/)?instrumentation\.[cm]?[jt]sx?$/.test(file);
  return /^(src\/)?(index|main|app|server)\.[cm]?[jt]sx?$/.test(file);
}

export function findUnused(ctx: AnalysisContext): Finding[] {
  const out: Finding[] = [];
  const usedNames = new Map<string, Set<string>>();
  for (const l of ctx.links) {
    const s = usedNames.get(l.to) ?? new Set<string>();
    for (const n of l.names) s.add(n);
    usedNames.set(l.to, s);
  }

  for (const f of Object.values(ctx.files)) {
    if (isTestFile(f.path) || isToolingConfig(f.path)) continue;
    const routeFile = ctx.framework === 'nextjs' && routeFileInfo(f.path) !== null;
    const used = usedNames.get(f.path) ?? new Set<string>();
    if (used.has('*')) continue;
    for (const e of f.exports) {
      if (e.kind === 'type' || e.kind === 'reexport' || e.name === '*') continue;
      if (routeFile && FRAMEWORK_EXPORTS.has(e.name)) continue;
      if (used.has(e.name)) continue;
      if (f.functions.some((fn) => fn.refs.includes(e.name))) continue;
      const fn = f.functions.find((x) => x.exportName === e.name);
      out.push(
        makeFinding(
          'unused-export',
          'certain',
          [f.path],
          [ctx.owner(f.path, fn?.name)],
          msg.unusedExport(e.name),
          `No file imports "${e.name}" from ${f.path}. If it is really unused, delete it. If something should use it, wire it up instead.`,
          e.name,
        ),
      );
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const l of ctx.links) adjacency.set(l.from, [...(adjacency.get(l.from) ?? []), l.to]);
  const reached = new Set<string>();
  const queue = Object.keys(ctx.files).filter((p) => isEntryFile(p, ctx.framework));
  while (queue.length) {
    const p = queue.pop()!;
    if (reached.has(p)) continue;
    reached.add(p);
    for (const next of adjacency.get(p) ?? []) if (!reached.has(next)) queue.push(next);
  }
  for (const p of Object.keys(ctx.files)) {
    if (reached.has(p)) continue;
    out.push(
      makeFinding(
        'orphan-file',
        'certain',
        [p],
        [ctx.owner(p)],
        msg.orphanFile(p),
        `${p} is not imported by any page, route or other used file. Delete it if it is leftover, or import it where it was meant to be used.`,
      ),
    );
  }
  return out;
}
