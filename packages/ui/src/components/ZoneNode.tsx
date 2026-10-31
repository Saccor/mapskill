import type { NodeProps, Node } from '@xyflow/react';
import { memo } from 'react';
import type { Zone } from '@mapskill/core/client';

export type ZoneData = { zone: Zone; title: string; countText: string; onToggle: (zone: Zone) => void; collapsed: boolean };

function ZoneNodeView({ data }: NodeProps<Node<ZoneData>>) {
  return (
    <div className="zone" data-zone={data.zone}>
      <button className="zone-header" aria-expanded={!data.collapsed} onClick={() => data.onToggle(data.zone)}>
        {data.title} <span className="zone-count">{data.countText}</span>
      </button>
    </div>
  );
}

export const ZoneNode = memo(ZoneNodeView);
