import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type DaemonServer } from './server';
import { fakeServerDeps } from './server-test-helpers';

let server: DaemonServer | undefined;
const tmpDirs: string[] = [];
afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A parent folder holding `ui/` (the served folder) and `secret.txt` (outside it). */
function uiFixture(): { uiDir: string; secret: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-ui-'));
  tmpDirs.push(parent);
  const dir = path.join(parent, 'ui');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Mapskill</title>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app-1.js'), 'console.log(1)');
  const secret = 'TOP-SECRET-CONTENT';
  fs.writeFileSync(path.join(parent, 'secret.txt'), secret);
  return { uiDir: dir, secret };
}

describe('static map view', () => {
  it('serves index.html and assets without a token, with security headers', async () => {
    server = await startServer({ ...fakeServerDeps(), uiDir: uiFixture().uiDir });
    const base = `http://127.0.0.1:${server.port}`;
    const index = await fetch(`${base}/?t=abc`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(index.headers.get('cache-control')).toBe('no-cache');
    const csp = index.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(`connect-src 'self' ws://127.0.0.1:${server.port} ws://localhost:${server.port};`);
    expect(csp).not.toContain(':*');
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(index.headers.get('referrer-policy')).toBe('no-referrer');
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await index.text()).toContain('Mapskill');
    const js = await fetch(`${base}/assets/app-1.js`);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/some/route`)).status).toBe(200);
  });

  it('answers HEAD with the headers and no body', async () => {
    server = await startServer({ ...fakeServerDeps(), uiDir: uiFixture().uiDir });
    const res = await fetch(`http://127.0.0.1:${server.port}/`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe('');
  });

  it('refuses paths outside the folder and still protects the API', async () => {
    const { uiDir, secret } = uiFixture();
    server = await startServer({ ...fakeServerDeps(), uiDir });
    const base = `http://127.0.0.1:${server.port}`;
    for (const p of ['/assets/..%2F..%2Fsecret.txt', '/..%2Fsecret.txt', '/assets/..%5C..%5Csecret.txt', '/..%5Csecret.txt']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(404);
      expect(await res.text(), p).not.toContain(secret);
    }
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/api/graph`)).status).toBe(401);
  });

  it('explains how to build the map view when it is missing', async () => {
    server = await startServer({ ...fakeServerDeps(), uiDir: null });
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('pnpm build:plugin');
  });
});
