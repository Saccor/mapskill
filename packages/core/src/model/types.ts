export type Framework = 'nextjs' | 'generic';

export type NodeType =
  | 'page' | 'layout' | 'api-route' | 'server-action' | 'component'
  | 'helper' | 'table' | 'service' | 'test' | 'config' | 'file';

export type Zone = 'pages' | 'blocks' | 'server' | 'data' | 'shared' | 'outside' | 'tests';

export interface Text { en: string; sv: string }

export interface ImportBinding { imported: string; local: string }

export interface ImportFact {
  specifier: string;
  /** imported: 'default', '*', or the exported name. Empty for side-effect imports. */
  bindings: ImportBinding[];
  typeOnly: boolean;
  line: number;
}

export interface ExportFact {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'reexport';
  line: number;
}

export interface FunctionFact {
  name: string;
  /** Name under which the function is exported ('default' for default export). */
  exportName?: string;
  startLine: number;
  endLine: number;
  returnsJsx: boolean;
  statements: number;
  exactHash: string;
  renamedHash: string;
  shingles: number[];
  cognitive: number;
  maxNesting: number;
  /** Identifiers referenced in the body, excluding property names. Sorted, unique. */
  refs: string[];
}

export interface CallFact {
  kind: 'fetch' | 'table' | 'env';
  value: string;
  op?: 'read' | 'write';
  line: number;
  inFunction?: string;
}

export interface ProblemFact {
  kind: 'swallowed-error' | 'hardcoded-secret';
  line: number;
  detail?: string;
  inFunction?: string;
}

export interface FileFacts {
  path: string;
  hash: string;
  lines: number;
  mtimeMs: number;
  directives: string[];
  imports: ImportFact[];
  exports: ExportFact[];
  functions: FunctionFact[];
  calls: CallFact[];
  problems: ProblemFact[];
  /** Identifiers referenced anywhere in the file (top level, bodies, type positions), excluding declaration names. Sorted, unique. */
  fileRefs: string[];
  parseError?: string;
  /** True when the current content does not parse and these facts come from the last version that did. `parseError` describes the current content. */
  stale?: boolean;
}

export interface FileLink { from: string; to: string; names: string[]; typeOnly: boolean }

export interface MapNode {
  id: string;
  type: NodeType;
  zone: Zone;
  label: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  route?: string;
  planned?: boolean;
}

export type EdgeKind = 'uses' | 'calls-api' | 'reads' | 'writes' | 'talks-to' | 'tests';

export interface MapEdge { id: string; from: string; to: string; kind: EdgeKind }

export type FindingKind =
  | 'exact-duplicate' | 'renamed-duplicate' | 'near-duplicate'
  | 'unused-export' | 'orphan-file'
  | 'complex-function' | 'long-file'
  | 'client-touches-server' | 'page-touches-table' | 'circular-import'
  | 'hardcoded-secret' | 'swallowed-error';

export type Certainty = 'certain' | 'likely';

export interface Finding {
  id: string;
  kind: FindingKind;
  certainty: Certainty;
  nodeIds: string[];
  files: string[];
  message: Text;
  /** Ready-made instruction for Claude, in English. */
  instruction: string;
}

export interface Graph {
  root: string;
  framework: Framework;
  files: Record<string, FileFacts>;
  links: FileLink[];
  nodes: MapNode[];
  edges: MapEdge[];
  findings: Finding[];
  health: Record<string, number>;
}
