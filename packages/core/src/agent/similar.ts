import type { FileFacts, FunctionFact, MapNode } from '../model/types';
import { extractFacts } from '../parse/extract';

export interface SimilarQuery {
  name?: string;
  code?: string;
}

export interface SimilarMatch {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  nodeId?: string;
  /** 0..1, higher is more alike. */
  score: number;
  reason: 'same-code' | 'renamed-copy' | 'similar-code' | 'similar-name';
}

const MIN_SCORE = 0.3;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Lower-case words of an identifier: formatDateISO -> format, date, iso. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** The first function in `code`; code that holds no function is treated as a function body. */
function snippetFunction(code: string): FunctionFact | undefined {
  for (const file of ['snippet.ts', 'snippet.tsx']) {
    const facts = extractFacts(file, code);
    if (!facts.parseError && facts.functions[0]) return facts.functions[0];
  }
  return extractFacts('snippet.tsx', `function snippet() {\n${code}\n}\n`).functions[0];
}

function nameScore(query: string, name: string): number {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  let score = jaccard(new Set(nameWords(query)), new Set(nameWords(name))) * 0.9;
  if (q.length >= 3 && n.length >= 3 && (n.includes(q) || q.includes(n))) score = Math.max(score, 0.55);
  return score;
}

/** Existing functions that look like `query` (by name, by code, or both), best first. */
export function findSimilar(
  files: Record<string, FileFacts>,
  nodes: MapNode[],
  query: SimilarQuery,
  limit = 5,
): SimilarMatch[] {
  const name = query.name?.trim() || undefined;
  const probe = query.code?.trim() ? snippetFunction(query.code) : undefined;
  if (!name && !probe) return [];
  const probeShingles = probe ? new Set(probe.shingles) : undefined;
  const out: SimilarMatch[] = [];
  for (const f of Object.values(files)) {
    if (TEST_FILE.test(f.path)) continue;
    for (const fn of f.functions) {
      let score = 0;
      let reason: SimilarMatch['reason'] = 'similar-name';
      if (probe && probeShingles) {
        if (fn.exactHash === probe.exactHash) [score, reason] = [1, 'same-code'];
        else if (fn.renamedHash === probe.renamedHash) [score, reason] = [0.95, 'renamed-copy'];
        else [score, reason] = [jaccard(probeShingles, new Set(fn.shingles)), 'similar-code'];
      }
      if (name) {
        const byName = nameScore(name, fn.name);
        if (byName > score) [score, reason] = [byName, 'similar-name'];
      }
      if (score < MIN_SCORE) continue;
      const nodeId = nodes.find((n) => n.file === f.path && n.id.endsWith(`#${fn.name}`))?.id;
      out.push({
        name: fn.name,
        file: f.path,
        startLine: fn.startLine,
        endLine: fn.endLine,
        ...(nodeId ? { nodeId } : {}),
        score: Math.round(score * 100) / 100,
        reason,
      });
    }
  }
  out.sort((a, b) => b.score - a.score || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.startLine - b.startLine);
  return out.slice(0, limit);
}
