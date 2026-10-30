import type { Finding } from '../model/types';
import type { AnalysisContext } from './context';
import { findDuplicates } from './duplicates';

export function runAnalyzers(ctx: AnalysisContext): Finding[] {
  return [...findDuplicates(ctx)];
}
