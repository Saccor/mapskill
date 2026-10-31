import type { Zone } from '@mapskill/core/client';

export const ZONE_COLUMNS: Zone[][] = [
  ['pages', 'blocks', 'shared'],
  ['server', 'data', 'outside', 'tests'],
];
export const COLS_PER_ZONE: Record<Zone, number> = { pages: 3, blocks: 3, shared: 3, server: 2, data: 2, outside: 2, tests: 2 };
export const CARD = { width: 200, height: 48, gapX: 12, gapY: 10 } as const;
export const ZONE_BOX = { padding: 16, header: 36, gap: 24, columnGap: 40 } as const;

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Saved slots at or above this are treated as missing (a broken layout file must not stretch a zone). */
export const MAX_SLOT = 10_000;

/**
 * Keeps every part's saved slot; new parts take the lowest free slots of their zone, in id order.
 * In core every node id starts with its type and the zone follows from the type, so an id never changes zone:
 * a part that moves zone is always a new id. That is why the lowest-id clash rule cannot displace a part
 * on a normal zone change.
 */
export function assignSlots(nodes: { id: string; zone: Zone }[], saved: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  const zones = new Map<Zone, { id: string; zone: Zone }[]>();
  for (const node of nodes) zones.set(node.zone, [...(zones.get(node.zone) ?? []), node]);
  for (const list of zones.values()) {
    const sorted = [...list].sort(byId);
    const taken = new Set<number>();
    const fresh: string[] = [];
    for (const { id } of sorted) {
      const slot = saved[id];
      if (slot !== undefined && slot < MAX_SLOT && !taken.has(slot)) {
        taken.add(slot);
        out[id] = slot;
      } else fresh.push(id);
    }
    let next = 0;
    for (const id of fresh) {
      while (taken.has(next)) next++;
      taken.add(next);
      out[id] = next;
    }
  }
  return out;
}

export interface ZoneBox {
  zone: Zone;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
  collapsed: boolean;
}

export interface MapLayout {
  zones: ZoneBox[];
  /** Part positions relative to their zone box (React Flow child positions). */
  positions: Record<string, { x: number; y: number }>;
}

export function layoutMap(nodes: { id: string; zone: Zone }[], slots: Record<string, number>, collapsed: ReadonlySet<Zone>): MapLayout {
  const positions: Record<string, { x: number; y: number }> = {};
  const zones: ZoneBox[] = [];
  const byZone = new Map<Zone, string[]>();
  for (const node of nodes) byZone.set(node.zone, [...(byZone.get(node.zone) ?? []), node.id]);
  let columnX = 0;
  for (const column of ZONE_COLUMNS) {
    let y = 0;
    let widest = 0;
    for (const zone of column) {
      const ids = byZone.get(zone);
      if (!ids || ids.length === 0) continue;
      const cols = COLS_PER_ZONE[zone];
      const width = 2 * ZONE_BOX.padding + cols * CARD.width + (cols - 1) * CARD.gapX;
      const isCollapsed = collapsed.has(zone);
      let height = ZONE_BOX.header + ZONE_BOX.padding;
      if (!isCollapsed) {
        const maxSlot = Math.max(...ids.map((id) => slots[id] ?? 0));
        const rows = Math.max(1, Math.ceil((maxSlot + 1) / cols));
        height = ZONE_BOX.header + rows * (CARD.height + CARD.gapY) - CARD.gapY + ZONE_BOX.padding;
        for (const id of ids) {
          const s = slots[id] ?? 0;
          positions[id] = {
            x: ZONE_BOX.padding + (s % cols) * (CARD.width + CARD.gapX),
            y: ZONE_BOX.header + Math.floor(s / cols) * (CARD.height + CARD.gapY),
          };
        }
      }
      zones.push({ zone, x: columnX, y, width, height, count: ids.length, collapsed: isCollapsed });
      y += height + ZONE_BOX.gap;
      widest = Math.max(widest, width);
    }
    if (widest > 0) columnX += widest + ZONE_BOX.columnGap;
  }
  return { zones, positions };
}
