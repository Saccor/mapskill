import type { Certainty, FileFacts, FileLink, Finding, FindingKind, Framework, MapNode, Text } from '../model/types';
import { sha1 } from '../util/hash';

export interface AnalysisContext {
  files: Record<string, FileFacts>;
  links: FileLink[];
  nodes: MapNode[];
  owner: (file: string, fn?: string) => string | undefined;
  framework: Framework;
  /** Subdirectories (project-relative, no trailing slash) that have their own package.json. */
  nestedPackageDirs?: string[];
  /** True when the import graph may be incomplete (unresolved local imports, broken tsconfig, unrecognised framework layout). */
  degraded?: boolean;
  /** True when a root components.json (shadcn/ui) exists. */
  shadcn?: boolean;
}

/** Certainty for orphan-file and unused-export findings: 'certain' only when the graph is trustworthy for that file. */
export function reachabilityCertainty(ctx: AnalysisContext, file: string): Certainty {
  if (ctx.degraded) return 'likely';
  if ((ctx.nestedPackageDirs ?? []).some((d) => file.startsWith(d + '/'))) return 'likely';
  if (ctx.shadcn && /^(src\/)?components\/ui\//.test(file)) return 'likely';
  return 'certain';
}

export function makeFinding(
  kind: FindingKind,
  certainty: Certainty,
  files: string[],
  nodeIds: (string | undefined)[],
  message: Text,
  instruction: string,
  key = '',
): Finding {
  const ids = [...new Set(nodeIds.filter((x): x is string => Boolean(x)))].sort();
  const sortedFiles = [...new Set(files)].sort();
  const id = `${kind}:${sha1([...sortedFiles, ...ids, key].join('|')).slice(0, 12)}`;
  return { id, kind, certainty, nodeIds: ids, files: sortedFiles, message, instruction };
}
