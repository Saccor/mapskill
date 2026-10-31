import type { Zone } from '@mapskill/core/client';
import { useCallback, useEffect, useState } from 'react';
import { takeToken } from './api';
import { ActivityBar } from './components/ActivityBar';
import { Header } from './components/Header';
import { MapView } from './components/MapView';
import { SidePanel } from './components/SidePanel';
import { useMapConnection } from './connection';
import { pickLang, STRINGS, type Lang } from './i18n';
import { useSlots } from './slots';

const LANG_KEY = 'mapskill-lang';
const ERROR_MS = 6000;

const { token, cleanUrl } = takeToken(location, sessionStorage);
if (cleanUrl) history.replaceState(null, '', cleanUrl);

function savedLang(): string | null {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}

function MapApp({ token }: { token: string }) {
  const { state, api } = useMapConnection(token);
  const slots = useSlots(state.graph, api);
  const [lang, setLang] = useState<Lang>(() => pickLang(navigator.language, savedLang()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAllEdges, setShowAllEdges] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<Zone>>(() => new Set<Zone>(['tests']));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const toggleLang = (): void => {
    const next: Lang = lang === 'sv' ? 'en' : 'sv';
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // private window: the choice lasts this visit only
    }
  };
  const toggleZone = useCallback((zone: Zone) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(zone)) next.delete(zone);
      else next.add(zone);
      return next;
    });
  }, []);
  const select = useCallback((id: string | null) => setSelectedId(id), []);

  const graph = state.graph;
  const node = graph && selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;

  return (
    <div className="app">
      <Header graph={graph} status={state.status} lang={lang} showAllEdges={showAllEdges} onShowAllEdges={setShowAllEdges} onToggleLang={toggleLang} />
      <div className={`main${node ? '' : ' no-panel'}`}>
        <div className="map">
          {graph && slots ? (
            <MapView graph={graph} state={state} slots={slots} selectedId={selectedId} onSelect={select} showAllEdges={showAllEdges} collapsed={collapsed} onToggleZone={toggleZone} lang={lang} />
          ) : (
            <p className="muted center">{STRINGS[lang].connecting}</p>
          )}
        </div>
        {graph && node && (
          <div className="panel-wrap">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <SidePanel graph={graph} node={node} locked={!!node.file && state.lockedFiles.includes(node.file)} lang={lang} api={api} onSelect={select} onError={setError} />
          </div>
        )}
      </div>
      <ActivityBar activity={state.activity} requests={state.requests} graph={graph} lang={lang} api={api} />
    </div>
  );
}

export function App() {
  if (!token) {
    return (
      <main className="center">
        <p>{STRINGS.en.noToken}</p>
        <p lang="sv">{STRINGS.sv.noToken}</p>
      </main>
    );
  }
  return <MapApp token={token} />;
}
