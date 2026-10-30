import { FACTS_VERSION, type FileFacts } from '@mapskill/core';
import { ensureMapskillDir, mapskillPath, readJson, writeJsonAtomic } from './paths';

const CACHE_FILE = 'cache.json';

interface CacheFile {
  factsVersion: number;
  facts: Record<string, FileFacts>;
}

/** Facts from the last run, keyed by project-relative path. Empty when missing, corrupt or written by another FACTS_VERSION. */
export function readFactsCache(root: string): Record<string, FileFacts> {
  const cache = readJson<Partial<CacheFile>>(mapskillPath(root, CACHE_FILE));
  if (!cache || cache.factsVersion !== FACTS_VERSION || !cache.facts || typeof cache.facts !== 'object') return {};
  return cache.facts;
}

export function writeFactsCache(root: string, facts: Record<string, FileFacts>): void {
  ensureMapskillDir(root);
  const data: CacheFile = { factsVersion: FACTS_VERSION, facts };
  writeJsonAtomic(mapskillPath(root, CACHE_FILE), data);
}
