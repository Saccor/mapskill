import path from 'node:path';
import type { PublicGraph } from '../graph/delta';
import type { MapNode, Zone } from '../model/types';
import { ZONE_LABELS } from '../text/labels';

const ZONES: Zone[] = ['pages', 'server', 'blocks', 'shared', 'data', 'outside', 'tests'];
/** Code-unit order: the same on every machine, unlike localeCompare. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function nodeLine(n: MapNode, health: Record<string, number>): string {
  const where = n.file ? ` ${n.file}${n.startLine ? `:${n.startLine}-${n.endLine ?? n.startLine}` : ''}` : '';
  const h = health[n.id];
  return `- ${n.label} [${n.type}]${where}${h !== undefined && h < 10 ? ` (health ${h}/10)` : ''}`;
}

/** A short text map of the project for Claude: zones, their parts and health. */
export function mapOverview(g: PublicGraph, options: { maxNodes?: number; maxChars?: number } = {}): string {
  const maxNodes = options.maxNodes ?? 80;
  const maxChars = options.maxChars ?? 8000;
  const certain = g.findings.filter((f) => f.certainty === 'certain').length;
  const health = (id: string): number => g.health[id] ?? 10;
  const groups = ZONES.map((zone) => ({
    zone,
    nodes: g.nodes
      .filter((n) => n.zone === zone && !n.planned)
      .sort(
        (a, b) =>
          health(a.id) - health(b.id) ||
          cmp(a.file ?? '', b.file ?? '') ||
          (a.startLine ?? 0) - (b.startLine ?? 0) ||
          cmp(a.id, b.id),
      ),
  })).filter((x) => x.nodes.length > 0);

  const quota = new Map<Zone, number>();
  let left = maxNodes;
  const base = Math.floor(maxNodes / Math.max(groups.length, 1));
  for (const x of groups) {
    const q = Math.min(x.nodes.length, base);
    quota.set(x.zone, q);
    left -= q;
  }
  for (const x of groups) {
    const extra = Math.min(left, x.nodes.length - quota.get(x.zone)!);
    quota.set(x.zone, quota.get(x.zone)! + extra);
    left -= extra;
  }

  const lines = [
    `Project ${path.basename(g.root)} (${g.framework}): ${g.fileCount} files, ${g.nodes.length} parts, ` +
      `${g.findings.length} findings (${certain} certain, ${g.findings.length - certain} likely).`,
    'Health is 1-10, where 10 means no findings.',
  ];
  const hidden: string[] = [];
  for (const x of groups) {
    const zoneHealth = Math.round(x.nodes.reduce((s, n) => s + health(n.id), 0) / x.nodes.length);
    lines.push('', `${ZONE_LABELS[x.zone].en} (${x.nodes.length} parts, health ${zoneHealth}/10)`);
    const shown = quota.get(x.zone)!;
    for (const n of x.nodes.slice(0, shown)) lines.push(nodeLine(n, g.health));
    if (x.nodes.length > shown) hidden.push(`${x.nodes.length - shown} in ${ZONE_LABELS[x.zone].en}`);
  }
  if (hidden.length > 0) lines.push('', `Not shown: ${hidden.join(', ')}. Use node_details or find_similar for more.`);
  if (g.unreadableFiles.length > 0) lines.push('', `Could not be read (last good version used): ${g.unreadableFiles.join(', ')}`);
  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  const marker = '\n(cut to fit)';
  return text.slice(0, Math.max(0, maxChars - marker.length)) + marker;
}
