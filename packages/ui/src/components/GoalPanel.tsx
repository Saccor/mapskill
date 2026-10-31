import type { GoalStatus } from '@mapskill/core/client';
import { GHOST_PREFIX, goalLine } from '../goals';
import { t, type Lang } from '../i18n';

export function GoalPanel({ goal, lang, onSelect, onClose }: { goal: GoalStatus; lang: Lang; onSelect: (id: string) => void; onClose: () => void }) {
  return (
    <section
      className="goal-panel"
      aria-label={goalLine(goal, lang)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <h2>{goalLine(goal, lang)}</h2>
      <ul>
        {goal.items.map((i) => (
          <li key={i.id} className={i.done ? 'done' : 'missing'}>
            <span aria-hidden="true">{i.done ? '✓' : '○'} </span>
            <span className="sr-only">{t(lang, i.done ? 'itemDone' : 'itemMissing')}: </span>
            {!i.done && i.nodeType ? (
              <button className="link" onClick={() => onSelect(`${GHOST_PREFIX}${i.id}`)}>
                {i.title[lang]}
              </button>
            ) : (
              <span>{i.title[lang]}</span>
            )}
            <span className="muted why">{i.why[lang]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
