import type { GoalItemStatus, PublicGraph } from '@mapskill/core/client';
import { useEffect, useRef, useState } from 'react';
import type { Api } from '../api';
import { errorText } from '../errors';
import { buildText } from '../goals';
import { NODE_TYPE_TEXT, t, type Lang } from '../i18n';

export interface GhostPanelProps {
  graph: PublicGraph;
  item: GoalItemStatus;
  nodeId: string;
  lang: Lang;
  api: Api;
  onSelect: (id: string | null) => void;
  onError: (text: string) => void;
  /** Called after the build request went through, so the page can announce it. */
  onDone: (text: string) => void;
}

/** The side panel of a missing goal item: what it is, where it could go, and the way to have Claude build it. */
export function GhostPanel({ graph, item, nodeId, lang, api, onSelect, onError, onDone }: GhostPanelProps) {
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    heading.current?.focus();
    return () => clearTimeout(copyTimer.current);
  }, []);
  const title = item.title[lang];
  const typeName = item.nodeType ? NODE_TYPE_TEXT[item.nodeType].name[lang] : '';
  const text = (): string => buildText(item, graph, lang);

  return (
    <aside className="panel ghost-panel" aria-label={`${title}, ${t(lang, 'missing')}`}>
      <header className="panel-head">
        <h2 ref={heading} tabIndex={-1}>
          <span aria-hidden="true">+</span> {title}
        </h2>
        <span className="muted">{[t(lang, 'missing'), typeName].filter(Boolean).join(' · ')}</span>
        <button className="close" onClick={() => onSelect(null)} aria-label={t(lang, 'closePanel')}>
          ×
        </button>
      </header>

      <section>
        <p>{t(lang, 'ghostAbout')}</p>
        <p>{item.why[lang]}</p>
        {item.suggestPath && <p className="muted">{t(lang, 'suggestedPlace', { path: item.suggestPath })}</p>}
      </section>

      <section className="actions">
        <button
          onClick={() =>
            api.addRequest({ kind: 'build', text: text(), nodeId }).then(
              () => onDone(t(lang, 'buildQueued')),
              (err: unknown) => {
                console.warn(err);
                onError(t(lang, 'actionFailed', { error: errorText(err, lang) }));
              },
            )
          }
        >
          {t(lang, 'build')}
        </button>
        <button
          onClick={() =>
            navigator.clipboard.writeText(text()).then(
              () => {
                setCopied(true);
                clearTimeout(copyTimer.current);
                copyTimer.current = setTimeout(() => setCopied(false), 2000);
              },
              (err: unknown) => {
                console.warn(err);
                onError(t(lang, 'copyFailed'));
              },
            )
          }
        >
          {copied ? t(lang, 'copied') : t(lang, 'copy')}
        </button>
      </section>
    </aside>
  );
}
