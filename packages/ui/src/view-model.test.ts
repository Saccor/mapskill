import type { PublicGraph } from '@mapskill/core/client';
import { describe, expect, it } from 'vitest';
import { activityLine, isTextEntry, unreadableLine, findingsByNode, nextPulseEnd, partFlags, projectHealth, related, visibleEdges } from './view-model';

const g: PublicGraph = {
  root: '/p', framework: 'nextjs', fileCount: 3, unreadableFiles: [],
  nodes: [
    { id: 'page:app/page.tsx', type: 'page', zone: 'pages', label: '/', file: 'app/page.tsx' },
    { id: 'helper:lib/date.ts#formatDate', type: 'helper', zone: 'shared', label: 'formatDate', file: 'lib/date.ts' },
    { id: 'table:orders', type: 'table', zone: 'data', label: 'orders' },
  ],
  edges: [
    { id: 'e1', from: 'page:app/page.tsx', to: 'helper:lib/date.ts#formatDate', kind: 'uses' },
    { id: 'e2', from: 'page:app/page.tsx', to: 'table:orders', kind: 'reads' },
  ],
  findings: [
    { id: 'f1', kind: 'exact-duplicate', certainty: 'certain', nodeIds: ['helper:lib/date.ts#formatDate'], files: ['lib/date.ts'], message: { en: 'm', sv: 'm' }, instruction: 'i' },
  ],
  health: { 'page:app/page.tsx': 10, 'helper:lib/date.ts#formatDate': 7, 'table:orders': 10 },
};

describe('view model', () => {
  it('groups findings by part and computes project health', () => {
    expect(findingsByNode(g)['helper:lib/date.ts#formatDate'].map((f) => f.id)).toEqual(['f1']);
    expect(projectHealth(g)).toBe(9);
    expect(projectHealth({ ...g, nodes: [] })).toBe(10);
  });

  it('flags pulsing, touched and locked parts by file', () => {
    const flags = partFlags(g, { pulseUntil: { 'lib/date.ts': 5000 }, touchedThisTurn: ['app/page.tsx'], lockedFiles: ['lib/date.ts'] }, 4000);
    expect(flags['helper:lib/date.ts#formatDate']).toEqual({ pulsing: true, touched: false, locked: true, unreadable: false });
    expect(flags['page:app/page.tsx']).toEqual({ pulsing: false, touched: true, locked: false, unreadable: false });
    expect(flags['table:orders']).toEqual({ pulsing: false, touched: false, locked: false, unreadable: false });
    expect(nextPulseEnd({ a: 5000, b: 3000 }, 4000)).toBe(5000);
    expect(nextPulseEnd({ a: 3000 }, 4000)).toBeNull();
  });

  it('flags parts whose file could not be read, and words the header line', () => {
    const bad = { ...g, unreadableFiles: ['lib/date.ts'] };
    const flags = partFlags(bad, { pulseUntil: {}, touchedThisTurn: [], lockedFiles: [] }, 0);
    expect(flags['helper:lib/date.ts#formatDate'].unreadable).toBe(true);
    expect(flags['page:app/page.tsx'].unreadable).toBe(false);
    expect(unreadableLine(g, 'en')).toBeNull();
    expect(unreadableLine(bad, 'en')).toBe('Could not read: lib/date.ts');
    const many = { ...g, unreadableFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'] };
    expect(unreadableLine(many, 'sv')).toBe('Kunde inte läsas: a.ts, b.ts, c.ts +2');
  });

  it('keeps the pulse end helper', () => {
    expect(nextPulseEnd({ a: 5000, b: 3000 }, 4000)).toBe(5000);
    expect(nextPulseEnd({ a: 3000 }, 4000)).toBeNull();
  });

  it('shows edges for the selected part, all, or none', () => {
    expect(visibleEdges(g, null, false)).toEqual([]);
    expect(visibleEdges(g, 'table:orders', false).map((e) => e.id)).toEqual(['e2']);
    expect(visibleEdges(g, null, true)).toHaveLength(2);
  });

  it('lists who uses a part and what it uses', () => {
    expect(related(g, 'helper:lib/date.ts#formatDate').usedBy.map((x) => x.label)).toEqual(['/']);
    expect(related(g, 'page:app/page.tsx').uses.map((x) => x.label)).toEqual(['formatDate', 'orders']);
  });

  it('describes activity in plain words', () => {
    const line = activityLine({ at: 0, files: [{ path: 'lib/date.ts', by: 'claude' }, { path: 'x/y.ts', by: 'watcher' }] }, g, 'en');
    expect(line).toBe('Claude changed formatDate, y.ts');
    const many = activityLine({ at: 0, files: ['a', 'b', 'c', 'd', 'e'].map((p) => ({ path: `${p}.ts`, by: 'watcher' as const })) }, g, 'sv');
    expect(many).toBe('Någon ändrade a.ts, b.ts, c.ts +2');
  });

  it('says there are no changes when the file list is empty', () => {
    expect(activityLine({ at: 0, files: [] }, g, 'en')).toBe('No changes yet.');
  });

  it('knows which elements take typed text (Escape must leave those alone)', () => {
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry({ tagName: 'DIV' })).toBe(false);
  });
});
