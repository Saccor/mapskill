import { describe, expect, it } from 'vitest';
import { scanProject } from '../graph/scan';
import { fixture } from '../test-helpers';
import { isEntryFile } from './unused';

describe('findUnused', () => {
  it('flags unused exports and orphan files in messy-app', () => {
    const g = scanProject(fixture('messy-app'));
    const unused = g.findings.filter((f) => f.kind === 'unused-export');
    const orphans = g.findings.filter((f) => f.kind === 'orphan-file').map((f) => f.files[0]);
    expect(unused.some((f) => f.nodeIds.includes('helper:lib/date.ts#formatDateCopy'))).toBe(true);
    expect(unused.some((f) => f.nodeIds.includes('component:components/OldBanner.tsx#OldBanner'))).toBe(true);
    expect(unused.some((f) => f.nodeIds.includes('helper:lib/date.ts#formatDate'))).toBe(false);
    expect(orphans).toContain('components/OldBanner.tsx');
    expect(orphans).not.toContain('lib/date.ts');
  });

  it.each(['clean-app', 'conventions-app'])('reports nothing in %s', (name) => {
    const g = scanProject(fixture(name));
    expect(g.findings.filter((f) => f.kind === 'unused-export' || f.kind === 'orphan-file')).toEqual([]);
  });

  it('maps conventions-app routes', () => {
    const g = scanProject(fixture('conventions-app'));
    const labels = g.nodes.filter((n) => n.type === 'page' || n.type === 'api-route').map((n) => n.label).sort();
    expect(labels).toEqual(['/about', '/blog/[slug]', 'ALL /api/legacy', 'GET,POST /api/items']);
  });

  it('treats route files, root files and tests as entry points', () => {
    expect(isEntryFile('app/page.tsx', 'nextjs')).toBe(true);
    expect(isEntryFile('next.config.mjs', 'nextjs')).toBe(true);
    expect(isEntryFile('lib/x.test.ts', 'nextjs')).toBe(true);
    expect(isEntryFile('lib/x.ts', 'nextjs')).toBe(false);
    expect(isEntryFile('src/index.ts', 'generic')).toBe(true);
    expect(isEntryFile('pages/_app.tsx', 'nextjs')).toBe(true);
    expect(isEntryFile('app/sitemap.ts', 'nextjs')).toBe(true);
    expect(isEntryFile('src/app/blog/opengraph-image.tsx', 'nextjs')).toBe(true);
    expect(isEntryFile('lib/sitemap.ts', 'nextjs')).toBe(false);
  });
});
