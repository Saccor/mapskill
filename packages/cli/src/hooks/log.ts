// packages/cli/src/hooks/log.ts
import fs from 'node:fs';
import { ensureMapskillDir, mapskillPath } from '../daemon/paths';
import { isJsProject } from './input';

const MAX_LOG_BYTES = 1_000_000;

/** Appends one line to .mapskill/log.txt. Only inside JS projects; never throws. */
export function logHookProblem(root: string, event: string, problem: unknown): void {
  try {
    if (!isJsProject(root)) return;
    ensureMapskillDir(root);
    const file = mapskillPath(root, 'log.txt');
    let flag = 'a';
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) flag = 'w';
    } catch {
      // no log yet
    }
    const text = problem instanceof Error ? (problem.stack ?? problem.message) : String(problem);
    fs.writeFileSync(file, `${new Date().toISOString()} ${event}: ${text.replace(/\s*\n\s*/g, ' | ')}\n`, { flag });
  } catch {
    // logging is best effort
  }
}
