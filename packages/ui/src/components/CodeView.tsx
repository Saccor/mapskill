import { useEffect, useState } from 'react';
import type { Api } from '../api';
import { t, type Lang } from '../i18n';

const LINES = 40;

type Highlighter = { codeToHtml(code: string, options: { lang: string; themes: { light: string; dark: string } }): string };
let highlighter: Promise<Highlighter | null> | null = null;

/** Shiki with only tsx/typescript and two themes, loaded on first use. Null when it cannot load. */
function loadHighlighter(): Promise<Highlighter | null> {
  // The JavaScript regex engine avoids WebAssembly, which the page's Content-Security-Policy does not allow.
  highlighter ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('shiki/langs/tsx.mjs'),
    import('shiki/langs/typescript.mjs'),
    import('shiki/themes/github-light.mjs'),
    import('shiki/themes/github-dark.mjs'),
  ])
    .then(
      ([core, js, tsx, ts, light, dark]) =>
        core.createHighlighterCore({
          themes: [light.default, dark.default],
          langs: [tsx.default, ts.default],
          engine: js.createJavaScriptRegexEngine(),
        }) as Promise<Highlighter>,
    )
    .catch(() => null);
  return highlighter;
}

export function CodeView({ api, file, start, lang }: { api: Api; file: string; start: number; lang: Lang }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setLines(null);
    setHtml(null);
    setFailed(false);
    api.source(file, start, start + LINES - 1).then(
      async (answer) => {
        if (!alive) return;
        setLines(answer.lines);
        const h = await loadHighlighter();
        if (!alive || !h) return;
        const language = file.endsWith('.tsx') || file.endsWith('.jsx') ? 'tsx' : 'typescript';
        try {
          setHtml(h.codeToHtml(answer.lines.join('\n'), { lang: language, themes: { light: 'github-light', dark: 'github-dark' } }));
        } catch {
          // keep the plain text
        }
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [api, file, start]);
  if (failed) return <p className="muted">{t(lang, 'codeFailed')}</p>;
  if (!lines) return <p className="muted">{t(lang, 'codeLoading')}</p>;
  // Shiki's HTML is generated locally from our own source text and escapes it; it carries no scripts.
  if (html) return <div className="code" style={{ counterReset: `line ${start - 1}` }} dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <pre className="code plain">
      {lines.map((l, i) => (
        <div key={i}>
          <span className="ln">{start + i}</span>
          {l}
        </div>
      ))}
    </pre>
  );
}
