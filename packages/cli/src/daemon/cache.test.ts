import path from 'node:path';
import { FACTS_VERSION, loadProject } from '@mapskill/core';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { readFactsCache, writeFactsCache } from './cache';
import { writeJsonAtomic } from './paths';

describe('facts cache', () => {
  it('round-trips facts', () => {
    const root = tmpProject({ 'a.ts': 'export const a = 1;\n' });
    const project = loadProject(root);
    writeFactsCache(root, project.facts);
    expect(readFactsCache(root)).toEqual(project.facts);
  });

  it('ignores a cache written by another facts version', () => {
    const root = tmpProject({ 'a.ts': 'export const a = 1;\n' });
    writeFactsCache(root, loadProject(root).facts);
    writeJsonAtomic(path.join(root, '.mapskill', 'cache.json'), { factsVersion: FACTS_VERSION + 1, facts: { 'a.ts': {} } });
    expect(readFactsCache(root)).toEqual({});
  });

  it('ignores a missing or corrupt cache', () => {
    expect(readFactsCache(tmpProject({}))).toEqual({});
    expect(readFactsCache(tmpProject({ '.mapskill/cache.json': '{' }))).toEqual({});
  });
});
