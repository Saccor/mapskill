import type { Certainty, Finding, FindingKind, FunctionFact } from '../model/types';
import { msg } from '../text/messages';
import { makeFinding, type AnalysisContext } from './context';

interface Item {
  file: string;
  mtime: number;
  fn: FunctionFact;
}

const MIN_STATEMENTS = 5;
const MIN_NEAR_STATEMENTS = 8;
const NEAR_THRESHOLD = 0.8;

export function findDuplicates(ctx: AnalysisContext): Finding[] {
  const items: Item[] = Object.values(ctx.files).flatMap((f) => f.functions.map((fn) => ({ file: f.path, mtime: f.mtimeMs, fn })));
  const key = (x: Item): string => `${x.file}#${x.fn.name}#${x.fn.startLine}`;
  const claimed = new Set<string>();
  const out: Finding[] = [];

  const passes: [FindingKind, (x: Item) => string][] = [
    ['exact-duplicate', (x) => x.fn.exactHash],
    ['renamed-duplicate', (x) => x.fn.renamedHash],
  ];
  for (const [kind, hashOf] of passes) {
    const groups = new Map<string, Item[]>();
    for (const x of items) {
      if (x.fn.statements < MIN_STATEMENTS) continue;
      const g = groups.get(hashOf(x)) ?? [];
      g.push(x);
      groups.set(hashOf(x), g);
    }
    for (const g of groups.values()) {
      if (g.length < 2 || g.every((x) => claimed.has(key(x)))) continue;
      for (const x of g) claimed.add(key(x));
      out.push(duplicateFinding(kind, 'certain', g, ctx));
    }
  }

  const big = items.filter((x) => x.fn.statements >= MIN_NEAR_STATEMENTS && !claimed.has(key(x)));
  const sets = big.map((x) => new Set(x.fn.shingles));
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (Math.min(a.size, b.size) / Math.max(a.size, b.size) < NEAR_THRESHOLD) continue;
      let inter = 0;
      for (const s of a) if (b.has(s)) inter++;
      const similarity = inter / (a.size + b.size - inter);
      if (similarity >= NEAR_THRESHOLD) out.push(duplicateFinding('near-duplicate', 'likely', [big[i], big[j]], ctx, similarity));
    }
  }
  return out;
}

function duplicateFinding(kind: FindingKind, certainty: Certainty, group: Item[], ctx: AnalysisContext, similarity = 1): Finding {
  const sorted = [...group].sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file) || a.fn.startLine - b.fn.startLine);
  const keep = sorted[0];
  const where = (x: Item): string => `${x.fn.name} (${x.file}:${x.fn.startLine})`;
  const names = sorted.map((x) => x.fn.name).join(', ');
  const message =
    kind === 'exact-duplicate'
      ? msg.exactDuplicate(names)
      : kind === 'renamed-duplicate'
        ? msg.renamedDuplicate(names)
        : msg.nearDuplicate(names, Math.round(similarity * 100));
  const instruction =
    `${sorted.map(where).join(', ')} are ${kind.replace('-', ' ')}s. ` +
    `Keep ${where(keep)}, make the others use it, and delete the copies. ` +
    `If they must stay separate, tell the user why.`;
  return makeFinding(
    kind,
    certainty,
    sorted.map((x) => x.file),
    sorted.map((x) => ctx.owner(x.file, x.fn.name)),
    message,
    instruction,
  );
}
