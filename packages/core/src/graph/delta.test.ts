import { describe, expect, it } from 'vitest';
import type { Finding, MapEdge, MapNode } from '../model/types';
import { fixture } from '../test-helpers';
import { applyDelta, diffGraphs, isEmptyDelta, toPublicGraph, type PublicGraph } from './delta';
import { scanProject } from './scan';

const node = (id: string, label = id): MapNode => ({ id, type: 'helper', zone: 'shared', label });
const edge = (from: string, to: string): MapEdge => ({ id: `uses:${from}->${to}`, from, to, kind: 'uses' });
const finding = (id: string, sv = id): Finding => ({
  id,
  kind: 'unused-export',
  certainty: 'certain',
  nodeIds: [],
  files: [],
  message: { en: id, sv },
  instruction: '',
});
const graph = (nodes: MapNode[], edges: MapEdge[], findings: Finding[], extra: Partial<PublicGraph> = {}): PublicGraph => ({
  root: '/p',
  framework: 'nextjs',
  nodes,
  edges,
  findings,
  health: {},
  fileCount: nodes.length,
  unreadableFiles: [],
  ...extra,
});
const byId = <T extends { id: string }>(xs: T[]): T[] => [...xs].sort((a, b) => a.id.localeCompare(b.id));
const sorted = (g: PublicGraph): PublicGraph => ({ ...g, nodes: byId(g.nodes), edges: byId(g.edges), findings: byId(g.findings) });

describe('diffGraphs', () => {
  it('is empty for identical graphs', () => {
    const g = toPublicGraph(scanProject(fixture('messy-app')));
    expect(isEmptyDelta(diffGraphs(g, g), g)).toBe(true);
  });

  it('lists added, removed and changed items', () => {
    const before = graph([node('a'), node('b')], [edge('a', 'b')], [finding('f1'), finding('f2')]);
    const after = graph([node('a', 'A!'), node('c')], [edge('a', 'c')], [finding('f1', 'ändrad'), finding('f3')]);
    const d = diffGraphs(before, after);
    expect(d.addedNodes.map((n) => n.id)).toEqual(['c']);
    expect(d.removedNodeIds).toEqual(['b']);
    expect(d.changedNodes.map((n) => n.label)).toEqual(['A!']);
    expect(d.addedEdges.map((e) => e.id)).toEqual(['uses:a->c']);
    expect(d.removedEdgeIds).toEqual(['uses:a->b']);
    expect(d.addedFindings.map((f) => f.id)).toEqual(['f3']);
    expect(d.resolvedFindingIds).toEqual(['f2']);
    expect(d.changedFindings.map((f) => f.message.sv)).toEqual(['ändrad']);
    expect(isEmptyDelta(d, before)).toBe(false);
    expect(sorted(applyDelta(before, d))).toEqual(sorted(after));
  });

  it('notices a file that became unreadable even when nothing else changed', () => {
    const before = graph([node('a')], [], []);
    const after = graph([node('a')], [], [], { unreadableFiles: ['a.ts'] });
    const d = diffGraphs(before, after);
    expect(isEmptyDelta(d, before)).toBe(false);
    expect(applyDelta(before, d).unreadableFiles).toEqual(['a.ts']);
  });

  it('turns one real graph into another', () => {
    const a = toPublicGraph(scanProject(fixture('clean-app')));
    const b = { ...toPublicGraph(scanProject(fixture('messy-app'))), root: a.root };
    expect(sorted(applyDelta(a, diffGraphs(a, b)))).toEqual(sorted(b));
  });
});

describe('toPublicGraph', () => {
  it('drops per-file facts and links but keeps counts', () => {
    const g = scanProject(fixture('clean-app'));
    const p = toPublicGraph(g) as PublicGraph & { files?: unknown; links?: unknown };
    expect(p.files).toBeUndefined();
    expect(p.links).toBeUndefined();
    expect(p.fileCount).toBe(Object.keys(g.files).length);
    expect(p.unreadableFiles).toEqual([]);
  });
});
