import type { Finding, MapNode } from '../model/types';

export function computeHealth(nodes: MapNode[], findings: Finding[]): Record<string, number> {
  const score: Record<string, number> = {};
  for (const n of nodes) score[n.id] = 10;
  for (const f of findings) {
    for (const id of f.nodeIds) {
      if (id in score) score[id] = Math.max(1, score[id] - (f.certainty === 'certain' ? 2 : 1));
    }
  }
  return score;
}
