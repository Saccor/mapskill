// Entry point for the map view (browser). Only types and pure functions without TypeScript-compiler or node: imports.
export * from './model/types';
export * from './model/protocol';
export { applyDelta, type GraphDelta, type PublicGraph } from './graph/delta';
export { ZONE_LABELS } from './text/labels';
export { ZONE_OF_TYPE } from './model/zones';
