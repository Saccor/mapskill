import type { FindingKind, NodeType, Text } from '../model/types';

export interface NodeFilter {
  type?: NodeType;
  /** Regex (case-insensitive) on the node's route. */
  routeMatches?: string;
  /** Service id ('stripe', 'supabase', …): the node or something it uses (up to 3 steps) talks to it. */
  talksTo?: string;
  /** Regex (case-insensitive) on a table name the node or something it uses (up to 3 steps) reads or writes. */
  touchesTable?: string;
  /** Regex (case-insensitive) on the node's label. */
  nameMatches?: string;
}

export type GoalCheck =
  | { fileExists: string }
  | { anyNode: NodeFilter }
  | { noFindings: FindingKind }
  | { all: GoalCheck[] }
  | { any: GoalCheck[] };

export interface GoalItem {
  id: string;
  title: Text;
  why: Text;
  nodeType?: NodeType;
  check: GoalCheck;
  suggest?: { path: string };
}

export interface GoalTemplate {
  id: string;
  title: Text;
  description: Text;
  extends?: string;
  items: GoalItem[];
}
