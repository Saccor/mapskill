import type { Zone } from '@mapskill/core/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { takeToken } from './api';
import { ActivityBar } from './components/ActivityBar';
import { GhostPanel } from './components/GhostPanel';
import { GoalPanel } from './components/GoalPanel';
import { Header } from './components/Header';
import { MapView } from './components/MapView';
import { SidePanel } from './components/SidePanel';
import { useMapConnection } from './connection';
import { errorText } from './errors';
import { ghostItem, goalLine, withGhosts } from './goals';
import { pickLang, STRINGS, t, type Lang } from './i18n';
import { useSlots } from './slots';
import { isTextEntry } from './view-model';

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
  const { state, dispatch, api, stale } = useMapConnection(token);
  const [lang, setLang] = useState<Lang>(() => pickLang(navigator.language, savedLang()));
  // The map shows the real parts plus the goal's missing items as ghosts; ghosts get slots like any part.
  const shown = useMemo(() => (state.graph ? withGhosts(state.graph, state.goal, lang) : null), [state.graph, state.goal, lang]);
  const slots = useSlots(shown, api, state.status, state.goal);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAllEdges, setShowAllEdges] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<Zone>>(() => new Set<Zone>(['tests']));
  const [goalOpen, setGoalOpen] = useState(false);
  const goalToggle = useRef<HTMLButtonElement>(null);
  const goalCall = useRef(0);
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((text: string) => {
    // Empty first, so the same text twice in a row is still read out.
    setAnnouncement('');
    clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnouncement(text), 50);
  }, []);
  useEffect(() => () => clearTimeout(announceTimer.current), []);
  const showError = useCallback((text: string) => setError({ text, at: Date.now() }), []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const hasNode = !!(shown && selectedId && shown.nodes.some((n) => n.id === selectedId));
  const closeGoal = useCallback(() => {
    setGoalOpen(false);
    goalToggle.current?.focus();
  }, []);
  // A goal that goes away takes its panel with it.
  const hasGoal = state.goal !== null;
  useEffect(() => {
    if (!hasGoal) setGoalOpen(false);
  }, [hasGoal]);
  const goalPanelOpen = goalOpen && hasGoal;
  useEffect(() => {
    if (!hasNode && !goalPanelOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const target = e.target;
      if (target instanceof HTMLElement && isTextEntry(target)) return;
      // Focus decides: inside the goal panel (or on its button) Escape closes it; otherwise a selected part
      // is deselected first, and only then the goal panel closes.
      const active = document.activeElement;
      const inGoal = active instanceof HTMLElement && (active === goalToggle.current || !!active.closest('.goal-panel'));
      if (goalPanelOpen && (inGoal || !hasNode)) closeGoal();
      else if (hasNode) setSelectedId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasNode, goalPanelOpen, closeGoal]);
  const lastSelected = useRef<string | null>(null);
  // The selected part vanished from the map (file deleted, project rescanned): nothing is selected any more.
  useEffect(() => {
    if (shown && selectedId && !hasNode) setSelectedId(null);
  }, [shown, selectedId, hasNode]);
  useEffect(() => {
    if (selectedId) {
      lastSelected.current = selectedId;
      return;
    }
    if (!lastSelected.current) return;
    const id = lastSelected.current;
    lastSelected.current = null;
    // The map re-measures its parts after the panel closes (they are not focusable meanwhile), so retry briefly.
    let tries = 0;
    const timer = setInterval(() => {
      const part = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
      part?.focus();
      if (!part || document.activeElement === part || ++tries >= 20) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
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
  const chooseGoal = (id: string | null): void => {
    // Only the answer to the latest choice counts; the WebSocket push keeps the status current either way.
    const call = ++goalCall.current;
    api.setGoal(id).then(
      (answer) => {
        if (call !== goalCall.current) return;
        dispatch({ type: 'goal', answer });
        announce(answer.status ? goalLine(answer.status, lang) : t(lang, 'noGoal'));
      },
      (err: unknown) => {
        if (call === goalCall.current) showError(errorText(err, lang));
      },
    );
  };

  const graph = state.graph;
  const node = shown && selectedId ? shown.nodes.find((n) => n.id === selectedId) ?? null : null;
  const ghost = node?.planned && selectedId ? ghostItem(state.goal, selectedId) : null;
  // A planned node without its goal item has nothing to show: it must never fall through to the real-part panel.
  const showPanel = !!(graph && node && (!node.planned || ghost));

  return (
    <div className="app">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {stale && (
        <p className="error stale" role="alert">
          {STRINGS[lang].staleTab}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error.text}
        </p>
      )}
      <Header graph={graph} status={state.status} lang={lang} showAllEdges={showAllEdges} onShowAllEdges={setShowAllEdges} onToggleLang={toggleLang}
        goals={state.goals}
        goal={state.goal}
        onChooseGoal={chooseGoal}
        goalOpen={goalOpen}
        onToggleGoal={() => setGoalOpen((v) => !v)}
        goalToggleRef={goalToggle}
      />
      {state.goal && goalOpen && <GoalPanel goal={state.goal} lang={lang} onSelect={select} />}
      <div className={`main${showPanel ? '' : ' no-panel'}`}>
        <div className="map">
          {shown && slots ? (
            <MapView graph={shown} state={state} slots={slots} selectedId={selectedId} onSelect={select} showAllEdges={showAllEdges} collapsed={collapsed} onToggleZone={toggleZone} lang={lang} />
          ) : (
            <p className="muted center">{STRINGS[lang].connecting}</p>
          )}
        </div>
        {graph && node && showPanel && (
          <div className="panel-wrap">
            {ghost ? (
              <GhostPanel key={node.id} graph={graph} item={ghost} nodeId={node.id} lang={lang} api={api} onSelect={select} onError={showError} onDone={announce} />
            ) : (
              <SidePanel key={node.id} graph={graph} node={node} locked={!!node.file && state.lockedFiles.includes(node.file)} lang={lang} api={api} onSelect={select} onError={showError} onDone={announce} />
            )}
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
