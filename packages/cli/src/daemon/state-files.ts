import type { LayoutFile } from '@mapskill/core';
import { ensureMapskillDir, mapskillPath, readJson, writeJsonAtomic } from './paths';

export function readDismissed(root: string): Record<string, string> {
  const data = readJson<{ dismissed?: Record<string, unknown> }>(mapskillPath(root, 'dismissed.json'));
  const out: Record<string, string> = {};
  for (const [id, hash] of Object.entries(data?.dismissed ?? {})) if (typeof hash === 'string') out[id] = hash;
  return out;
}

export function writeDismissed(root: string, dismissed: Record<string, string>): void {
  ensureMapskillDir(root);
  writeJsonAtomic(mapskillPath(root, 'dismissed.json'), { version: 1, dismissed });
}

export function readLayout(root: string): LayoutFile {
  const data = readJson<{ slots?: Record<string, unknown> }>(mapskillPath(root, 'layout.json'));
  const slots: Record<string, number> = {};
  for (const [id, slot] of Object.entries(data?.slots ?? {})) {
    if (typeof slot === 'number' && Number.isInteger(slot) && slot >= 0) slots[id] = slot;
  }
  return { version: 1, slots };
}

/** Most slots kept in layout.json: a full save of this size still fits the 1 MB request body limit. */
export const MAX_LAYOUT_ENTRIES = 10_000;

/** The stored slots plus an incoming save (incoming wins and counts as newest); over the cap the oldest go first. */
export function mergeLayout(existing: Record<string, number>, incoming: Record<string, number>): Record<string, number> {
  const entries = [...Object.entries(existing).filter(([id]) => !Object.hasOwn(incoming, id)), ...Object.entries(incoming)];
  return Object.fromEntries(entries.slice(-MAX_LAYOUT_ENTRIES));
}

export function writeLayout(root: string, layout: LayoutFile): void {
  ensureMapskillDir(root);
  writeJsonAtomic(mapskillPath(root, 'layout.json'), { version: 1, slots: layout.slots });
}
