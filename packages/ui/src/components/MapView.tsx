import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi, type AriaLabelConfig, type Edge, type Node } from '@xyflow/react';
import { ZONE_LABELS, type EdgeKind, type PublicGraph, type Zone } from '@mapskill/core/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/** A part before the cheap per-render flags are added: everything that only changes with the graph, slots, folds or language. */
interface PartSkeleton {
  node: Node;
  data: Omit<PartData, 'pulsing' | 'touched' | 'locked' | 'selected' | 'ariaLabel'>;
  /** Label pieces before and after the lock text, so the lock can be added without rebuilding the rest. */
  ariaBefore: string;
  ariaAfter: string;
}

interface Skeleton {
  /** Zone headers and part skeletons in tab order. */
  items: ({ kind: 'zone'; node: Node } | { kind: 'part'; part: PartSkeleton })[];
  shown: Set<string>;
}

export function MapView(props: MapViewProps) {
  return (
    <ReactFlowProvider>
      <MapViewInner {...props} />
    </ReactFlowProvider>
  );
}

function MapViewInner({ graph, state, slots, selectedId, onSelect, showAllEdges, collapsed, onToggleZone, lang }: MapViewProps) {
  const flow = useReactFlow();
  const store = useStoreApi();
  // Keyboard focus on a part that is outside the view pans the map to it; a part already in view causes no movement.
  const onFocusPart = useCallback(
    (id: string) => {
      // The browser may scroll the clipped wrapper to reveal the focused button; the map pans with its own transform instead.
      const wrapper = document.querySelector<HTMLElement>('.react-flow');
      if (wrapper && (wrapper.scrollTop !== 0 || wrapper.scrollLeft !== 0)) {
        wrapper.scrollTop = 0;
        wrapper.scrollLeft = 0;
      }
      const node = flow.getInternalNode(id);
      if (!node) return;
      const { width: vw, height: vh } = store.getState();
      const { x: tx, y: ty, zoom } = flow.getViewport();
      const { x, y } = node.internals.positionAbsolute;
      const w = node.measured.width ?? 0;
      const h = node.measured.height ?? 0;
      const left = x * zoom + tx;
      const top = y * zoom + ty;
      if (left >= 0 && top >= 0 && left + w * zoom <= vw && top + h * zoom <= vh) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      void flow.setCenter(x + w / 2, y + h / 2, { zoom, duration: reduced ? 0 : 200 });
    },
    [flow, store],
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const end = nextPulseEnd(state.pulseUntil, now);
    if (end === null) return;
    const timer = setTimeout(() => setNow(Date.now()), end - now + 20);
    return () => clearTimeout(timer);
  }, [state.pulseUntil, now]);
  useEffect(() => setNow(Date.now()), [state.pulseUntil]);

  const labels = useMemo(() => ariaLabels(lang), [lang]);

  // The expensive part: positions and texts. Runs only when the graph, the slots, the folds or the language change.
  const skeleton = useMemo<Skeleton>(() => {
    const layout = layoutMap(graph.nodes, slots, collapsed);
    const findings = findingsByNode(graph);
    const bySlot = (a: { id: string }, b: { id: string }) => (slots[a.id] ?? 0) - (slots[b.id] ?? 0);
    const unreadable = new Set(graph.unreadableFiles);
    const items: Skeleton['items'] = [];
    const shown = new Set<string>();
    // Zone header, then that zone's parts: the tab order follows the map (parents still precede children).
    for (const z of layout.zones) {
      items.push({
        kind: 'zone',
        node: {
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
        },
      });
      const inZone = graph.nodes.filter((n) => n.zone === z.zone && layout.positions[n.id]).sort(bySlot);
      for (const n of inZone) {
        shown.add(n.id);
        const count = findings[n.id]?.length ?? 0;
        const health = graph.health[n.id] ?? 10;
        const isUnreadable = n.file !== undefined && unreadable.has(n.file);
        const ariaBefore = [
          n.label,
          NODE_TYPE_TEXT[n.type].name[lang],
          health < 10 ? t(lang, 'health', { score: health }).toLowerCase() : '',
          count > 0 ? `${count} ${t(lang, 'findings').toLowerCase()}` : '',
        ]
          .filter(Boolean)
          .join(', ');
        items.push({
          kind: 'part',
          part: {
            ariaBefore,
            ariaAfter: isUnreadable ? t(lang, 'unreadableShort') : '',
            data: {
              node: n,
              health,
              findingCount: count,
              unreadable: isUnreadable,
              lockedText: t(lang, 'locked'),
              unreadableText: t(lang, 'unreadableShort'),
              onSelect,
              onFocusPart,
            },
            node: {
              id: n.id,
              type: 'part',
              parentId: `zone:${n.zone}`,
              extent: 'parent',
              position: layout.positions[n.id],
              draggable: false,
              data: {},
            },
          },
        });
      }
    }
    return { items, shown };
  }, [graph, slots, collapsed, lang, onSelect, onToggleZone, onFocusPart]);

  // The cheap part: pulse, touched, lock and selection flags. A part whose flags did not change keeps its node object,
  // so React (and React Flow) skip it.
  const cache = useRef<{ skeleton: Skeleton; nodes: Map<string, { key: string; node: Node }> } | null>(null);
  const nodes = useMemo(() => {
    if (cache.current?.skeleton !== skeleton) cache.current = { skeleton, nodes: new Map() };
    const reuse = cache.current.nodes;
    const flags = partFlags(graph, state, now);
    return skeleton.items.map((item) => {
      if (item.kind === 'zone') return item.node;
      const { part } = item;
      const id = part.node.id;
      const f = flags[id];
      const selected = id === selectedId;
      const key = `${f.pulsing ? 1 : 0}${f.touched ? 1 : 0}${f.locked ? 1 : 0}${selected ? 1 : 0}`;
      const hit = reuse.get(id);
      if (hit && hit.key === key) return hit.node;
      const ariaLabel = [part.ariaBefore, f.locked ? t(lang, 'locked') : '', part.ariaAfter].filter(Boolean).join(', ');
      const node: Node = {
        ...part.node,
        data: { ...part.data, pulsing: f.pulsing, touched: f.touched, locked: f.locked, selected, ariaLabel } satisfies PartData,
      };
      reuse.set(id, { key, node });
      return node;
    });
  }, [skeleton, graph, state, now, selectedId, lang]);

  const edges = useMemo<Edge[]>(
    () =>
      visibleEdges(graph, selectedId, showAllEdges)
        .filter((e) => skeleton.shown.has(e.from) && skeleton.shown.has(e.to))
        .map((e) => ({
          id: e.id,
          source: e.from,
          target: e.to,
          label: EDGE_TEXT[e.kind][lang],
          animated: e.from === selectedId || e.to === selectedId,
        })),
    [graph, skeleton, selectedId, showAllEdges, lang],
  );

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
