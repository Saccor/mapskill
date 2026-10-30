const APP_SPECIAL = ['page', 'layout', 'route', 'loading', 'error', 'not-found', 'template', 'default', 'global-error'] as const;

export type RouteKind = (typeof APP_SPECIAL)[number] | 'pages-page' | 'pages-api' | 'middleware';

export interface RouteFile {
  kind: RouteKind;
  route: string;
}

export function routeFileInfo(rel: string): RouteFile | null {
  const p = rel.startsWith('src/') ? rel.slice(4) : rel;
  if (/^middleware\.[cm]?[jt]sx?$/.test(p)) return { kind: 'middleware', route: '/' };

  const app = /^app\/(.*?)([^/]+)\.[cm]?[jt]sx?$/.exec(p);
  if (app) {
    const base = app[2] as (typeof APP_SPECIAL)[number];
    if (!APP_SPECIAL.includes(base)) return null;
    const dirs = app[1].split('/').filter(Boolean);
    if (dirs.some((d) => d.startsWith('_'))) return null;
    const segments = dirs.filter((d) => !(d.startsWith('(') && d.endsWith(')')) && !d.startsWith('@'));
    return { kind: base, route: '/' + segments.join('/') };
  }

  const pages = /^pages\/(.+)\.[cm]?[jt]sx?$/.exec(p);
  if (pages) {
    const rest = pages[1];
    if (rest.startsWith('api/') || rest === 'api') {
      return { kind: 'pages-api', route: '/' + rest.replace(/\/index$/, '') };
    }
    return { kind: 'pages-page', route: '/' + rest.replace(/(^|\/)index$/, '') };
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function routeMatches(route: string, url: string): boolean {
  const segments = route.split('/').filter(Boolean);
  const pattern = segments
    .map((s) => {
      if (s.startsWith('[[...')) return '(?:/.*)?';
      if (s.startsWith('[...')) return '/.+';
      if (s.startsWith('[')) return '/[^/]+';
      return '/' + escapeRegex(s);
    })
    .join('');
  return new RegExp('^' + (pattern || '/') + '/?$').test(url);
}
