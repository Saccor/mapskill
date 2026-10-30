import type { Finding } from '../model/types';
import type { AnalysisContext } from './context';
import { findDuplicates } from './duplicates';
import { findUnused } from './unused';

export function runAnalyzers(ctx: AnalysisContext): Finding[] {
  return [...findDuplicates(ctx), ...findUnused(ctx)];
}
