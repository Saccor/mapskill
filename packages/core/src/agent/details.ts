import type { PublicGraph } from '../graph/delta';
import type { MapNode } from '../model/types';
import { ZONE_LABELS } from '../text/labels';

const MAX_NODES = 10;

function label(g: PublicGraph, id: string): string {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) return id;
  return `${n.label} [${n.type}]${n.file ? ` (${n.file})` : ''}`;
}

function describe(g: PublicGraph, n: MapNode): string {
  const lines = [`${n.label} [${n.type}] in ${ZONE_LABELS[n.zone].en}`];
  if (n.file) lines.push(`File: ${n.file}${n.startLine ? ` lines ${n.startLine}-${n.endLine ?? n.startLine}` : ''}`);
  if (n.route) lines.push(`Route: ${n.route}`);
  lines.push(`Health: ${g.health[n.id] ?? 10}/10`);
  const into = g.edges.filter((e) => e.to === n.id && (e.kind === 'uses' || e.kind === 'tests'));
  const out = g.edges.filter((e) => e.from === n.id);
  const list = (ids: string[]): string => (ids.length ? [...new Set(ids)].map((id) => label(g, id)).join('; ') : '(nothing)');
  lines.push(`Used by: ${list(into.map((e) => e.from))}`);
  lines.push(`Uses: ${list(out.filter((e) => e.kind === 'uses').map((e) => e.to))}`);
  const data = out.filter((e) => e.kind !== 'uses' && e.kind !== 'tests');
  if (data.length) lines.push(`Data and services: ${data.map((e) => `${label(g, e.to)} (${e.kind})`).join('; ')}`);
  const findings = g.findings.filter((f) => f.nodeIds.includes(n.id));
  if (findings.length === 0) lines.push('Findings: none');
  else {
    lines.push('Findings:');
    for (const f of findings) lines.push(`- [${f.certainty}] ${f.message.en}`, `  For Claude: ${f.instruction}`);
  }
  return lines.join('\n');
}

/** Details about one node (by id) or about every node in a file (by path). Null when nothing matches. */
export function nodeDetails(g: PublicGraph, query: { id?: string; path?: string }): string | null {
  let nodes: MapNode[] = [];
  if (query.id) nodes = g.nodes.filter((n) => n.id === query.id);
  else if (query.path) {
    const p = query.path.replace(/\\/g, '/').replace(/^\.\//, '');
    nodes = g.nodes.filter((n) => n.file === p);
  }
  if (nodes.length === 0) return null;
  const shown = nodes.slice(0, MAX_NODES).map((n) => describe(g, n));
  if (nodes.length > MAX_NODES) shown.push(`(${nodes.length - MAX_NODES} more parts in this file)`);
  return shown.join('\n\n');
}
