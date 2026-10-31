import type { MapRequest, PublicGraph } from '@mapskill/core/client';
import { useState } from 'react';
import type { Api } from '../api';
import { t, type Lang } from '../i18n';
import type { Activity } from '../reducer';
import { pendingCount } from '../requests';
import { activityLine } from '../view-model';

export function ActivityBar({ activity, requests, graph, lang, api, onError }: { activity: Activity[]; requests: MapRequest[]; graph: PublicGraph | null; lang: Lang; api: Api; onError: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const latest = activity[0];
  const pending = requests.filter((r) => r.status === 'pending');
  const fail = (err: unknown): void => onError(t(lang, 'actionFailed', { error: err instanceof Error ? err.message : String(err) }));
  const time = latest ? new Date(latest.at).toLocaleTimeString(lang === 'sv' ? 'sv-SE' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <footer className="activity">
      <span aria-live="polite">{latest ? `${activityLine(latest, graph, lang)} · ${time}` : t(lang, 'activityNone')}</span>
      {pendingCount(requests) > 0 && (
        <span
          className="pending"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <button aria-expanded={open} onClick={() => setOpen(!open)}>
            {t(lang, 'pendingRequests', { n: pending.length })}
          </button>
          {open && (
            <ul className="pending-list">
              {pending.map((r) => (
                <li key={r.id}>
                  <span>{r.text}</span>
                  <button onClick={() => navigator.clipboard.writeText(r.text).catch(fail)}>{t(lang, 'copy')}</button>
                  <button onClick={() => api.cancelRequest(r.id).catch(fail)}>{t(lang, 'cancel')}</button>
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
      <a className="credit" href="https://reactflow.dev" target="_blank" rel="noreferrer noopener">
        Map: React Flow
      </a>
    </footer>
  );
}
