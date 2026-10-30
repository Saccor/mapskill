import type { Graph } from '../model/types';
import { loadProject } from './project';

export function scanProject(root: string): Graph {
  return loadProject(root).graph;
}
