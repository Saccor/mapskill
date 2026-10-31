import type { Finding, MapNode, PublicGraph } from '@mapskill/core/client';
import { useEffect, useRef, useState } from 'react';
import type { Api } from '../api';
import { errorText } from '../errors';
import { NODE_TYPE_TEXT, t, type Lang } from '../i18n';
import { NODE_ICON } from '../icons';
import { explainText, fixText } from '../requests';
import { findingsByNode, related } from '../view-model';
import { CodeView } from './CodeView';

export interface SidePanelProps {
  graph: PublicGraph;
  node: MapNode;
  locked: boolean;
  lang: Lang;
  api: Api;
  onSelect: (id: string | null) => void;
  onError: (text: string) => void;
  /** Called after Ask, Fix or It's fine went through, so the page can announce it. */
  onDone: (text: string) => void;
}

export function SidePanel({ graph, node, locked, lang, api, onSelect, onError, onDone }: SidePanelProps) {
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    heading.current?.focus();
    return () => clearTimeout(copyTimer.current);
  }, []);
  const findings: Finding[] = findingsByNode(graph)[node.id] ?? [];
  const { usedBy, uses } = related(graph, node.id);
  const health = graph.health[node.id] ?? 10;
  const fail = (key: 'actionFailed' | 'lockFailed') => (err: unknown) => {
    console.warn(err);
    onError(t(lang, key, { error: errorText(err, lang) }));
  };
  const queued = (): void => onDone(t(lang, 'requestQueued'));
  const failCopy = (err: unknown): void => {
    console.warn(err);
    onError(t(lang, 'copyFailed'));
  };

  const list = (items: MapNode[]) =>
    items.length === 0 ? (
      <p className="muted">{t(lang, 'nothing')}</p>
    ) : (
      <ul className="links">
        {items.map((n) => (
          <li key={n.id}>
            <button className="link" onClick={() => onSelect(n.id)}>
              <span aria-hidden="true">{NODE_ICON[n.type]}</span> {n.label}
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <aside className="panel" aria-label={node.label}>
      <header className="panel-head">
        <h2 ref={heading} tabIndex={-1}>
          <span aria-hidden="true">{NODE_ICON[node.type]}</span> {node.label}
        </h2>
        <span className="muted">{NODE_TYPE_TEXT[node.type].name[lang]}</span>
        <button className="close" onClick={() => onSelect(null)} aria-label={t(lang, 'closePanel')}>
          ×
        </button>
      </header>

      <section>
        <h3>{t(lang, 'whatItIs')}</h3>
        <p>{NODE_TYPE_TEXT[node.type].about[lang]}</p>
        {node.route && <p className="muted">{node.route}</p>}
        <p>{findings.length ? t(lang, 'healthExplained', { score: health, n: findings.length }) : t(lang, 'healthPerfect')}</p>
      </section>

      <section className="actions">
        {node.file && (
          <button onClick={() => api.setLock(node.id, !locked).catch(fail('lockFailed'))}>
            {locked ? `🔓 ${t(lang, 'unlock')}` : `🔒 ${t(lang, 'lock')}`}
          </button>
        )}
        <button onClick={() => api.addRequest({ kind: 'explain', text: explainText(node, lang), nodeId: node.id }).then(queued, fail('actionFailed'))}>
          {t(lang, 'ask')}
        </button>
        <button
          onClick={() =>
            navigator.clipboard.writeText(explainText(node, lang)).then(() => {
              setCopied(true);
              clearTimeout(copyTimer.current);
              copyTimer.current = setTimeout(() => setCopied(false), 2000);
            }, failCopy)
          }
        >
          {copied ? t(lang, 'copied') : t(lang, 'copy')}
        </button>
      </section>

      <section>
        <h3>{t(lang, 'findings')}</h3>
        {findings.length === 0 && <p className="muted">{t(lang, 'noFindings')}</p>}
        {findings.map((f) => (
          <div className="finding" key={f.id}>
            <p>
              <span aria-hidden="true">⚠ </span>
              {f.message[lang]} <span className="muted">({f.certainty === 'certain' ? (lang === 'sv' ? 'säkert' : 'certain') : lang === 'sv' ? 'troligt' : 'likely'})</span>
            </p>
            <button onClick={() => api.addRequest({ kind: 'fix', text: fixText(f, lang), findingId: f.id, nodeId: node.id }).then(queued, fail('actionFailed'))}>
              {t(lang, 'fixWithClaude')}
            </button>
            <button onClick={() => api.dismiss(f.id).then(() => onDone(t(lang, 'dismissedAnnounce')), fail('actionFailed'))}>{t(lang, 'itsFine')}</button>
          </div>
        ))}
      </section>

      <section>
        <h3>{t(lang, 'usedBy')}</h3>
        {list(usedBy)}
        <h3>{t(lang, 'uses')}</h3>
        {list(uses)}
      </section>

      <section>
        <h3>{t(lang, 'code')}</h3>
        {node.file ? (
          <>
            <p className="muted">{node.file}</p>
            <CodeView api={api} file={node.file} start={node.startLine ?? 1} lang={lang} />
          </>
        ) : (
          <p className="muted">{t(lang, 'noFile')}</p>
        )}
      </section>
    </aside>
  );
}
