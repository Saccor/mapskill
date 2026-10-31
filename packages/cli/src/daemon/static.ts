// packages/cli/src/daemon/static.ts
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

/** True for requests the map view's static files answer: GET/HEAD outside /api/ and /ws. */
export function isStaticRequest(method: string | undefined, pathname: string): boolean {
  return (method === 'GET' || method === 'HEAD') && !pathname.startsWith('/api/') && pathname !== '/ws';
}

/** Answers a static request from `uiDir`. Paths without an extension get index.html (the map is one page). */
export function serveStatic(uiDir: string | null, req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  const plain = (status: number, text: string): void => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    res.end(text);
  };
  if (!uiDir) return plain(404, 'Mapskill map view is not built. Run: pnpm build:plugin\n');
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return plain(404, 'not found\n');
  }
  const wantsPage = path.extname(decoded) === '';
  const file = path.resolve(uiDir, '.' + (wantsPage ? '/index.html' : decoded));
  const base = path.resolve(uiDir);
  const rootWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (!file.startsWith(rootWithSep)) return plain(404, 'not found\n');
  let body: Buffer;
  try {
    body = fs.readFileSync(file);
  } catch {
    return plain(404, 'not found\n');
  }
  const rel = path.relative(uiDir, file).split(path.sep).join('/');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'content-length': body.length,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
