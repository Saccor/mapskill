import type { GoalStatus, GoalSummary, PublicGraph } from '@mapskill/core/client';
import { goalLine } from '../goals';
import { t, type Lang } from '../i18n';
import type { MapState } from '../reducer';
import { projectHealth, unreadableLine } from '../view-model';

export function Header(props: {
  graph: PublicGraph | null;
  status: MapState['status'];
  lang: Lang;
  showAllEdges: boolean;
  onShowAllEdges: (v: boolean) => void;
  onToggleLang: () => void;
  goals: GoalSummary[];
  goal: GoalStatus | null;
  onChooseGoal: (id: string | null) => void;
  goalOpen: boolean;
  onToggleGoal: () => void;
}) {
  const { graph, status, lang } = props;
  const unreadable = graph ? unreadableLine(graph, lang) : null;
  const name = graph ? graph.root.split(/[\\/]/).filter(Boolean).pop() : '';
  return (
    <header className="topbar">
      <strong>{t(lang, 'appTitle')}</strong>
      {graph && (
        <span>
          {name} <span className="muted">({graph.framework})</span>
        </span>
      )}
      {graph && <span>{t(lang, 'health', { score: projectHealth(graph) })}</span>}
      {unreadable && (
        <span className="unreadable-line">
          <span aria-hidden="true">⚠ </span>
          {unreadable}
        </span>
      )}
      <label className="goal-select">
        {t(lang, 'goal')}{' '}
        <select value={props.goal?.goalId ?? ''} onChange={(e) => props.onChooseGoal(e.target.value || null)}>
          <option value="">{t(lang, 'noGoal')}</option>
          {props.goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title[lang]}
            </option>
          ))}
        </select>
      </label>
      {props.goal && (
        <>
          <span className="goal-progress" aria-label={goalLine(props.goal, lang)}>
            {props.goal.done}/{props.goal.total}
          </span>
          <button aria-expanded={props.goalOpen} onClick={props.onToggleGoal}>
            {t(lang, props.goalOpen ? 'hideGoal' : 'showGoal')}
          </button>
        </>
      )}
      <span className={`status ${status}`} role="status">
        {t(lang, status)}
      </span>
      <label className="toggle">
        <input type="checkbox" checked={props.showAllEdges} onChange={(e) => props.onShowAllEdges(e.target.checked)} /> {t(lang, 'showAllEdges')}
      </label>
      <button onClick={props.onToggleLang}>{t(lang, 'language')}</button>
    </header>
  );
}
