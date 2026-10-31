// Temporary; Task 8 replaces it.
import type { Zone } from '@mapskill/core/client';
import { useCallback, useState } from 'react';
import { takeToken } from './api';
import { MapView } from './components/MapView';
import { useMapConnection } from './connection';
import { useSlots } from './slots';

const { token, cleanUrl } = takeToken(location, sessionStorage);
if (cleanUrl) history.replaceState(null, '', cleanUrl);

function Connected({ token }: { token: string }) {
  const { state, api } = useMapConnection(token);
  const slots = useSlots(state.graph, api);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<Zone>>(() => new Set<Zone>(['tests']));
  const toggleZone = useCallback(
    (zone: Zone) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(zone)) next.add(zone);
        return next;
      }),
    [],
  );
  if (!state.graph || !slots) return <p>{state.status}</p>;
  return (
    <div className="map" style={{ height: '100vh' }}>
      <MapView
        graph={state.graph}
        state={state}
        slots={slots}
        selectedId={selectedId}
        onSelect={setSelectedId}
        showAllEdges={false}
        collapsed={collapsed}
        onToggleZone={toggleZone}
        lang="en"
      />
    </div>
  );
}

export function App() {
  return token ? <Connected token={token} /> : <p>No token</p>;
}
