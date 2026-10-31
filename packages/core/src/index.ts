export * from './model/types';
export { scanProject } from './graph/scan';
export { extractFacts, FACTS_VERSION } from './parse/extract';
export { routeFileInfo, routeMatches } from './adapters/nextjs/routes';
export { msg } from './text/messages';
export { ZONE_LABELS } from './text/labels';
export {
  applyFileChanges,
  buildGraph,
  findDrift,
  findingCodeHash,
  isProjectConfigFile,
  loadProject,
  readSourceFile,
  setDismissed,
  storeRead,
  MAX_FILE_BYTES,
  type ChangeResult,
  type Project,
  type ReadResult,
} from './graph/project';
export { createIgnoredDirFilter, createSourceFilter, isSkippedDir, listSourceFiles } from './scan/files';
export { applyDelta, diffGraphs, isEmptyDelta, toPublicGraph, type GraphDelta, type PublicGraph } from './graph/delta';
export * from './model/protocol';
export { findSimilar, nameWords, type SimilarMatch, type SimilarQuery } from './agent/similar';
export { mapOverview } from './agent/overview';
export { nodeDetails } from './agent/details';
export { BUILTIN_GOALS } from './goals/builtin';
export { evaluateGoal, findGoal, goalSummaries } from './goals/evaluate';
export { formatGoalFile, parseGoalFile } from './goals/goal-file';
export type { GoalCheck, GoalItem, GoalTemplate, NodeFilter } from './goals/types';
export { ZONE_OF_TYPE } from './model/zones';
