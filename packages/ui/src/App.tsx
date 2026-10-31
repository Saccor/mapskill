import type { Zone } from '@mapskill/core/client';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((text: string) => {
    // Empty first, so the same text twice in a row is still read out.
    setAnnouncement('');
    setTimeout(() => setAnnouncement(text), 50);
  }, []);
  const showError = useCallback((text: string) => setError({ text, at: Date.now() }), []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const hasNode = !!(state.graph && selectedId && state.graph.nodes.some((n) => n.id === selectedId));
  useEffect(() => {
    if (!hasNode) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      setSelectedId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasNode]);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId) lastSelected.current = selectedId;
    else if (lastSelected.current) {
      const id = lastSelected.current;
      lastSelected.current = null;
      // The map re-measures its parts after the panel closes (they are not focusable meanwhile), so retry briefly.
      let tries = 0;
      const timer = setInterval(() => {
        const part = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
        part?.focus();
        if (!part || document.activeElement === part || ++tries >= 20) clearInterval(timer);
      }, 50);
    }
  }, [selectedId]);

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
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <p className="error" role="alert">
          {error.text}
        </p>
      )}
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
            <SidePanel key={node.id} graph={graph} node={node} locked={!!node.file && state.lockedFiles.includes(node.file)} lang={lang} api={api} onSelect={select} onError={showError} onDone={announce} />
          </div>
        )}
      </div>
      <ActivityBar activity={state.activity} requests={state.requests} graph={graph} lang={lang} api={api} onError={showError} />
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
