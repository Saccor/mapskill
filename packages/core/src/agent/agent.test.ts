import { describe, expect, it } from 'vitest';
import { toPublicGraph } from '../graph/delta';
import { scanProject } from '../graph/scan';
import { fixture } from '../test-helpers';
import { nodeDetails } from './details';
import { mapOverview } from './overview';
import { findSimilar, nameWords } from './similar';

const messy = scanProject(fixture('messy-app'));
const pub = toPublicGraph(messy);

describe('nameWords', () => {
  it('splits camelCase, PascalCase, snake_case and acronyms', () => {
    expect(nameWords('formatDateISO')).toEqual(['format', 'date', 'iso']);
    expect(nameWords('HTTPServer')).toEqual(['http', 'server']);
    expect(nameWords('format_day2')).toEqual(['format', 'day2']);
  });
});

describe('findSimilar', () => {
  it('finds functions by name', () => {
    const hits = findSimilar(messy.files, messy.nodes, { name: 'formatDate' });
    expect(hits[0]).toMatchObject({ name: 'formatDate', file: 'lib/date.ts', startLine: 1, reason: 'similar-name' });
    expect(hits[0].nodeId).toBe('helper:lib/date.ts#formatDate');
    expect(hits.map((h) => h.name)).toContain('formatDateCopy');
  });

  it('finds the same code under other names', () => {
    const code = [
      'export function toIsoDay(raw: string): string {',
      '  const d = new Date(raw);',
      '  const y = d.getFullYear();',
      "  const m = String(d.getMonth() + 1).padStart(2, '0');",
      "  const dd = String(d.getDate()).padStart(2, '0');",
      '  return `${y}-${m}-${dd}`;',
      '}',
    ].join('\n');
    const hits = findSimilar(messy.files, messy.nodes, { code });
    expect(hits.length).toBe(3);
    expect(new Set(hits.map((h) => h.reason))).toEqual(new Set(['renamed-copy']));
    expect(hits.map((h) => h.name).sort()).toEqual(['formatDate', 'formatDateCopy', 'formatDay']);
  });

  it('accepts a bare code block and drops weak matches', () => {
    expect(findSimilar(messy.files, messy.nodes, { code: 'return 1;' })).toEqual([]);
    expect(findSimilar(messy.files, messy.nodes, { name: 'zzz' })).toEqual([]);
    expect(findSimilar(messy.files, messy.nodes, {})).toEqual([]);
  });
});

describe('mapOverview', () => {
  it('lists zones with their parts and stays within the budget', () => {
    const text = mapOverview(pub);
    expect(text).toContain('messy-app (nextjs)');
    expect(text).toContain('Pages');
    expect(text).toMatch(/- formatDate \[helper\] lib\/date\.ts:1-7/);
    const short = mapOverview(pub, { maxNodes: 3 });
    expect(short.split('\n').filter((l) => l.startsWith('- ')).length).toBeLessThanOrEqual(3);
    expect(short).toContain('Not shown:');
    expect(mapOverview(pub, { maxChars: 200 }).length).toBeLessThanOrEqual(200);
  });
});

describe('nodeDetails', () => {
  it('explains a node by id with users and findings', () => {
    const text = nodeDetails(pub, { id: 'helper:lib/date.ts#formatDate' })!;
    expect(text).toContain('formatDate [helper]');
    expect(text).toContain('lib/date.ts lines 1-7');
    expect(text).toMatch(/Used by:.*\//);
    expect(text).toContain('For Claude:');
  });

  it('lists every node in a file and returns null for unknown input', () => {
    const text = nodeDetails(pub, { path: './lib/date.ts' })!;
    expect(text).toContain('formatDate [helper]');
    expect(text).toContain('formatDateCopy [helper]');
    expect(nodeDetails(pub, { path: 'nope.ts' })).toBeNull();
    expect(nodeDetails(pub, {})).toBeNull();
  });
});
