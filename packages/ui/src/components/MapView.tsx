import { Background, Controls, ReactFlow, type AriaLabelConfig, type Edge, type Node } from '@xyflow/react';
import { ZONE_LABELS, type EdgeKind, type PublicGraph, type Zone } from '@mapskill/core/client';
import { useEffect, useMemo, useState } from 'react';
import { NODE_TYPE_TEXT, t, type Lang } from '../i18n';
import { layoutMap } from '../layout';
import type { MapState } from '../reducer';
import { findingsByNode, nextPulseEnd, partFlags, visibleEdges } from '../view-model';
import { PartNode, type PartData } from './PartNode';
import { ZoneNode, type ZoneData } from './ZoneNode';

const nodeTypes = { zone: ZoneNode, part: PartNode };

const EDGE_TEXT: Record<EdgeKind, { en: string; sv: string }> = {
  uses: { en: 'uses', sv: 'använder' },
  'calls-api': { en: 'calls', sv: 'anropar' },
  reads: { en: 'reads', sv: 'läser' },
  writes: { en: 'writes', sv: 'skriver' },
  'talks-to': { en: 'talks to', sv: 'pratar med' },
  tests: { en: 'tests', sv: 'testar' },
};

/** Every string React Flow adds to the page, in the user's language (none of them mention deleting: parts only open). */
export function ariaLabels(lang: Lang): AriaLabelConfig {
  return {
    'node.a11yDescription.default': t(lang, 'rfNodeDesc'),
    'node.a11yDescription.keyboardDisabled': t(lang, 'rfNodeDesc'),
    'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) => t(lang, 'rfMoved', { direction, x, y }),
    'edge.a11yDescription.default': t(lang, 'rfEdgeDesc'),
    'controls.ariaLabel': t(lang, 'rfControls'),
    'controls.zoomIn.ariaLabel': t(lang, 'rfZoomIn'),
    'controls.zoomOut.ariaLabel': t(lang, 'rfZoomOut'),
    'controls.fitView.ariaLabel': t(lang, 'rfFitView'),
    'controls.interactive.ariaLabel': t(lang, 'rfInteractive'),
    'minimap.ariaLabel': t(lang, 'rfMinimap'),
    'handle.ariaLabel': t(lang, 'rfHandle'),
  };
}

export interface MapViewProps {
  graph: PublicGraph;
  state: MapState;
  slots: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showAllEdges: boolean;
  collapsed: ReadonlySet<Zone>;
  onToggleZone: (zone: Zone) => void;
  lang: Lang;
}

export function MapView({ graph, state, slots, selectedId, onSelect, showAllEdges, collapsed, onToggleZone, lang }: MapViewProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const end = nextPulseEnd(state.pulseUntil, now);
    if (end === null) return;
    const timer = setTimeout(() => setNow(Date.now()), end - now + 20);
    return () => clearTimeout(timer);
  }, [state.pulseUntil, now]);
  useEffect(() => setNow(Date.now()), [state.pulseUntil]);

  const labels = useMemo(() => ariaLabels(lang), [lang]);
  const { nodes, edges } = useMemo(() => {
    const layout = layoutMap(graph.nodes, slots, collapsed);
    const flags = partFlags(graph, state, now);
    const findings = findingsByNode(graph);
    const out: Node[] = layout.zones.map((z) => ({
      id: `zone:${z.zone}`,
      type: 'zone',
      position: { x: z.x, y: z.y },
      style: { width: z.width, height: z.height },
      selectable: false,
      draggable: false,
      focusable: false,
      data: {
        zone: z.zone,
        title: ZONE_LABELS[z.zone][lang],
        countText: t(lang, 'zoneCount', { n: z.count }),
        collapsed: z.collapsed,
        onToggle: onToggleZone,
      } satisfies ZoneData,
    }));
    const bySlot = (a: { id: string }, b: { id: string }) => (slots[a.id] ?? 0) - (slots[b.id] ?? 0);
    const parts: typeof graph.nodes = [];
    const ordered: Node[] = [];
    // Zone header, then that zone's parts: the tab order follows the map (parents still precede children).
    for (const zoneNode of out) {
      ordered.push(zoneNode);
      const zone = (zoneNode.data as ZoneData).zone;
      const inZone = graph.nodes.filter((n) => n.zone === zone && layout.positions[n.id]).sort(bySlot);
      for (const n of inZone) {
        parts.push(n);
        const f = flags[n.id];
        const count = findings[n.id]?.length ?? 0;
        const health = graph.health[n.id] ?? 10;
        const typeName = NODE_TYPE_TEXT[n.type].name[lang];
        const aria = [
          n.label,
          typeName,
          health < 10 ? t(lang, 'health', { score: health }).toLowerCase() : '',
          count > 0 ? `${count} ${t(lang, 'findings').toLowerCase()}` : '',
          f.locked ? t(lang, 'locked') : '',
          f.unreadable ? t(lang, 'unreadableShort') : '',
        ]
          .filter(Boolean)
          .join(', ');
        ordered.push({
          id: n.id,
          type: 'part',
          parentId: `zone:${n.zone}`,
          extent: 'parent',
          position: layout.positions[n.id],
          draggable: false,
          data: {
            node: n,
            health,
            findingCount: count,
            pulsing: f.pulsing,
            touched: f.touched,
            locked: f.locked,
            unreadable: f.unreadable,
            selected: n.id === selectedId,
            ariaLabel: aria,
            lockedText: t(lang, 'locked'),
            unreadableText: t(lang, 'unreadableShort'),
            onSelect: (id: string) => onSelect(id),
          } satisfies PartData,
        });
      }
    }
    const shown = new Set(parts.map((p) => p.id));
    const flowEdges: Edge[] = visibleEdges(graph, selectedId, showAllEdges)
      .filter((e) => shown.has(e.from) && shown.has(e.to))
      .map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        label: EDGE_TEXT[e.kind][lang],
        animated: e.from === selectedId || e.to === selectedId,
      }));
    return { nodes: ordered, edges: flowEdges };
  }, [graph, slots, collapsed, state, now, selectedId, showAllEdges, lang, onSelect, onToggleZone]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      ariaLabelConfig={labels}
      colorMode="system"
      fitView
      minZoom={0.2}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      onPaneClick={() => onSelect(null)}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
