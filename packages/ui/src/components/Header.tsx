import type { PublicGraph } from '@mapskill/core/client';
import { t, type Lang } from '../i18n';
import type { MapState } from '../reducer';
import { projectHealth } from '../view-model';

export function Header(props: {
  graph: PublicGraph | null;
  status: MapState['status'];
  lang: Lang;
  showAllEdges: boolean;
  onShowAllEdges: (v: boolean) => void;
  onToggleLang: () => void;
}) {
  const { graph, status, lang } = props;
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
