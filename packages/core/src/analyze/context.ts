import type { Certainty, FileFacts, FileLink, Finding, FindingKind, Framework, MapNode, Text } from '../model/types';
import { sha1 } from '../util/hash';

export interface AnalysisContext {
  files: Record<string, FileFacts>;
  links: FileLink[];
  nodes: MapNode[];
  owner: (file: string, fn?: string) => string | undefined;
  framework: Framework;
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
  const ids = [...new Set(nodeIds.filter((x): x is string => Boolean(x)))];
  const sortedFiles = [...new Set(files)].sort();
  const id = `${kind}:${sha1([...sortedFiles, ...ids, key].join('|')).slice(0, 12)}`;
  return { id, kind, certainty, nodeIds: ids, files: sortedFiles, message, instruction };
}
