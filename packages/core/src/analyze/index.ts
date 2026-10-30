import type { Finding } from '../model/types';
import type { AnalysisContext } from './context';
import { findDuplicates } from './duplicates';
import { findRuleBreaks } from './rules';
import { findUnused } from './unused';

export function runAnalyzers(ctx: AnalysisContext): Finding[] {
  const seen = new Set<string>();
  return [...findDuplicates(ctx), ...findUnused(ctx), ...findRuleBreaks(ctx)].filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}
