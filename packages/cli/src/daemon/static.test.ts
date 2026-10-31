import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type DaemonServer } from './server';
import { fakeServerDeps } from './server-test-helpers';

let server: DaemonServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function uiFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-ui-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Mapskill</title>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app-1.js'), 'console.log(1)');
  return dir;
}

describe('static map view', () => {
  it('serves index.html and assets without a token, with security headers', async () => {
    server = await startServer({ ...fakeServerDeps(), uiDir: uiFixture() });
    const base = `http://127.0.0.1:${server.port}`;
    const index = await fetch(`${base}/?t=abc`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(index.headers.get('referrer-policy')).toBe('no-referrer');
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await index.text()).toContain('Mapskill');
    const js = await fetch(`${base}/assets/app-1.js`);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/some/route`)).status).toBe(200);
  });

  it('refuses paths outside the folder and still protects the API', async () => {
    server = await startServer({ ...fakeServerDeps(), uiDir: uiFixture() });
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${base}/assets/..%2F..%2F..%2Fsecret.txt`)).status).toBe(404);
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
