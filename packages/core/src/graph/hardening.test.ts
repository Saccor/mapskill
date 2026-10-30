import { describe, expect, it } from 'vitest';
import { fixture, tmpProject } from '../test-helpers';
import { scanProject } from './scan';

const NEXT = '{"dependencies":{"next":"16"}}';
const PAGE = `export default function P() { return null; }`;
const kinds = (files: Record<string, string>, kind: string) =>
  scanProject(tmpProject(files))
    .findings.filter((f) => f.kind === kind)
    .map((f) => `${f.files[0]}:${f.certainty}`);
const unusedOrOrphan = (files: Record<string, string>) =>
  scanProject(tmpProject(files)).findings.filter((x) => x.kind === 'unused-export' || x.kind === 'orphan-file');

describe('scanProject hardening', () => {
  it('exempts exports referenced elsewhere in the same file, including typeof', () => {
    const f = kinds(
      {
        'package.json': NEXT,
        'app/page.tsx': `import { client } from '../lib/s'; export default function P() { return <p>{client.url}</p>; }`,
        'lib/s.ts': `const z = { object: (x: unknown) => x };\nexport const userSchema = z.object({});\nexport type User = typeof userSchema;\nexport const url = 'u';\nexport const client = { url };`,
      },
      'unused-export',
    );
    expect(f).toEqual([]);
  });

  it('treats proxy, instrumentation and mdx-components as framework entry points', () => {
    expect(
      unusedOrOrphan({
        'package.json': NEXT,
        'src/app/page.tsx': PAGE,
        'src/proxy.ts': `export function proxy() {}\nexport const config = {};`,
        'src/instrumentation.ts': `export async function register() {}\nexport async function onRequestError() {}`,
        'src/mdx-components.tsx': `export function useMDXComponents() { return {}; }`,
      }),
    ).toEqual([]);
  });

  it('does not report Supabase anon keys; reports other JWTs; test files are likely', () => {
    const jwt = (role: string) =>
      ['{"alg":"HS256","typ":"JWT"}', JSON.stringify({ role, iss: 'supabase' })].map((s) => Buffer.from(s).toString('base64url')).join('.') +
      '.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
    const f = kinds(
      {
        'package.json': NEXT,
        'app/page.tsx': `export const a = '${jwt('anon')}'; ${PAGE}`,
        'lib/svc.ts': `export const b = '${jwt('service_role')}';`,
        'e2e/x.spec.ts': `export const c = '${jwt('service_role')}';`,
      },
      'hardcoded-secret',
    );
    expect(f.sort()).toEqual(['e2e/x.spec.ts:likely', 'lib/svc.ts:certain']);
  });

  it('ignores type-only imports for client-touches-server', () => {
    const f = kinds(
      {
        'package.json': NEXT,
        'app/page.tsx': `'use client';\nimport type { User } from '@prisma/client';\nimport { type Post } from '@prisma/client';\nexport default function P(p: { u?: User; q?: Post }) { return null; }`,
      },
      'client-touches-server',
    );
    expect(f).toEqual([]);
  });

  it('treats supabase/functions and convex as entry points', () => {
    expect(
      unusedOrOrphan({
        'package.json': NEXT,
        'app/page.tsx': PAGE,
        'supabase/functions/hello/index.ts': `export const handler = 1;`,
        'convex/messages.ts': `export const list = 1;`,
      }),
    ).toEqual([]);
  });

  it('downgrades orphans and unused exports inside nested package directories to likely', () => {
    const files = { 'package.json': NEXT, 'app/page.tsx': PAGE, 'tools/package.json': '{}', 'tools/a/x.ts': `export const y = 1;` };
    expect(kinds(files, 'orphan-file')).toEqual(['tools/a/x.ts:likely']);
    expect(kinds(files, 'unused-export')).toEqual(['tools/a/x.ts:likely']);
  });

  it('marks unused/orphan findings likely when a local import cannot be resolved', () => {
    const files = {
      'package.json': NEXT,
      'app/page.tsx': `import { gone } from '@/lib/missing'; export default function P() { return gone; }`,
      'lib/dead.ts': `export const dead = 1;`,
    };
    expect(kinds(files, 'orphan-file')).toEqual(['lib/dead.ts:likely']);
    expect(kinds(files, 'unused-export')).toEqual(['lib/dead.ts:likely']);
  });

  it('does not count css or image imports as unresolved', () => {
    const files = {
      'package.json': NEXT,
      'app/page.tsx': `import './globals.css'; import logo from './logo.svg'; export default function P() { return logo; }`,
      'lib/dead.ts': `export const dead = 1;`,
    };
    expect(kinds(files, 'orphan-file')).toEqual(['lib/dead.ts:certain']);
  });

  it('is degraded for a generic framework with an app directory, and for a broken tsconfig', () => {
    const generic = { 'package.json': '{}', 'src/app/page.tsx': PAGE, 'src/lib/dead.ts': `export const dead = 1;` };
    expect(kinds(generic, 'orphan-file').filter((x) => x.endsWith(':certain'))).toEqual([]);
    expect(kinds(generic, 'orphan-file')).toContain('src/lib/dead.ts:likely');
    const broken = { 'package.json': NEXT, 'tsconfig.json': '{ "compilerOptions": ', 'app/page.tsx': PAGE, 'lib/dead.ts': `export const dead = 1;` };
    expect(kinds(broken, 'orphan-file')).toEqual(['lib/dead.ts:likely']);
  });

  it('downgrades findings under components/ui when components.json exists', () => {
    const base = { 'package.json': NEXT, 'app/page.tsx': PAGE, 'src/components/ui/button.tsx': `export const buttonVariants = 1;` };
    const withShadcn = { ...base, 'components.json': '{}' };
    expect(kinds(withShadcn, 'orphan-file')).toEqual(['src/components/ui/button.tsx:likely']);
    expect(kinds(withShadcn, 'unused-export')).toEqual(['src/components/ui/button.tsx:likely']);
    expect(kinds(base, 'orphan-file')).toEqual(['src/components/ui/button.tsx:certain']);
  });

  it('survives oversized files and a BOM in package.json', () => {
    const g = scanProject(
      tmpProject({
        'package.json': '﻿{"dependencies":{"next":"16"}}',
        'app/page.tsx': PAGE,
        'lib/huge.ts': `export const big = '${'a'.repeat(1_100_000)}';`,
      }),
    );
    expect(g.framework).toBe('nextjs');
    expect(Object.keys(g.files)).toEqual(['app/page.tsx']);
  });

  it('never emits duplicate finding ids', () => {
    const g = scanProject(fixture('beginner-app'));
    const ids = g.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not flag a class imported with an inline type binding and used only as a type', () => {
    const f = kinds(
      {
        'package.json': NEXT,
        'app/page.tsx': `import { type Store, useStore } from '../lib/store'; export default function P(p: { s?: Store }) { return <p>{String(useStore())}</p>; }`,
        'lib/store.ts': `export class Store {}
export const useStore = () => 1;`,
      },
      'unused-export',
    );
    expect(f).toEqual([]);
  });

  it('degrades reachability findings when a file had to be skipped', () => {
    const files = { 'package.json': NEXT, 'app/page.tsx': PAGE, 'lib/dead.ts': `export const dead = 1;`, 'lib/huge.ts': `export const big = '${'a'.repeat(1_100_000)}';` };
    expect(kinds(files, 'orphan-file')).toEqual(['lib/dead.ts:likely']);
  });

  it('keeps live keys in app/api/test/route.ts certain', () => {
    const f = kinds({ 'package.json': NEXT, 'app/api/test/route.ts': `const k = 'sk_live_51HxAbCdEfGhIjKlMnOpQr';
export async function GET() { return Response.json(k); }` }, 'hardcoded-secret');
    expect(f).toEqual(['app/api/test/route.ts:certain']);
  });
});
