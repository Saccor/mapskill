import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { MapNode } from '@mapskill/core/client';
import { NODE_ICON } from '../icons';

export type PartData = {
  node: MapNode;
  health: number;
  findingCount: number;
  pulsing: boolean;
  touched: boolean;
  locked: boolean;
  selected: boolean;
  ariaLabel: string;
  lockedText: string;
  onSelect: (id: string) => void;
};

export function PartNode({ data }: NodeProps<Node<PartData>>) {
  const cls = ['part', data.pulsing && 'pulsing', data.touched && 'touched', data.selected && 'selected', data.findingCount > 0 && 'has-findings']
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className="part-handle" />
      <button className={cls} aria-pressed={data.selected} aria-label={data.ariaLabel} data-node-id={data.node.id} onClick={() => data.onSelect(data.node.id)}>
        <span aria-hidden="true">{NODE_ICON[data.node.type]}</span>
        <span className="label">{data.node.label}</span>
        {data.health < 10 && <span className="badge">{data.health}/10</span>}
        {data.findingCount > 0 && <span className="warn" aria-hidden="true">⚠ {data.findingCount}</span>}
        {data.locked && <span className="lock" aria-hidden="true">🔒 {data.lockedText}</span>}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} className="part-handle" />
    </>
  );
}
