import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixture } from '../../test-helpers';
import { isTestFile, isToolingConfig } from '../file-kinds';
import { isNextProject, readPrismaModels } from './project';
import { routeFileInfo, routeMatches } from './routes';
import { serviceForSpecifier } from './services';

describe('routeFileInfo', () => {
  it.each([
    ['app/page.tsx', { kind: 'page', route: '/' }],
    ['src/app/(marketing)/about/page.tsx', { kind: 'page', route: '/about' }],
    ['app/blog/[slug]/page.tsx', { kind: 'page', route: '/blog/[slug]' }],
    ['app/api/items/route.ts', { kind: 'route', route: '/api/items' }],
    ['app/@modal/login/page.tsx', { kind: 'page', route: '/login' }],
    ['app/dashboard/layout.tsx', { kind: 'layout', route: '/dashboard' }],
    ['app/not-found.tsx', { kind: 'not-found', route: '/' }],
    ['pages/index.tsx', { kind: 'pages-page', route: '/' }],
    ['pages/blog/index.tsx', { kind: 'pages-page', route: '/blog' }],
    ['pages/api/legacy.ts', { kind: 'pages-api', route: '/api/legacy' }],
    ['middleware.ts', { kind: 'middleware', route: '/' }],
  ])('%s', (file, expected) => {
    expect(routeFileInfo(file)).toEqual(expected);
  });

  it.each(['app/_components/Nav.tsx', 'app/_private/page.tsx', 'app/blog/utils.ts', 'lib/x.ts'])('%s is not a route file', (file) => {
    expect(routeFileInfo(file)).toBeNull();
  });
});

describe('routeMatches', () => {
  it('matches dynamic segments and fetch placeholders', () => {
    expect(routeMatches('/api/users/[id]', '/api/users/*')).toBe(true);
    expect(routeMatches('/api/users/[id]', '/api/users')).toBe(false);
    expect(routeMatches('/api/[...all]', '/api/a/b')).toBe(true);
    expect(routeMatches('/api/items', '/api/items')).toBe(true);
    expect(routeMatches('/', '/')).toBe(true);
  });
});

describe('services and file kinds', () => {
  it('maps package names to services', () => {
    expect(serviceForSpecifier('stripe')?.id).toBe('stripe');
    expect(serviceForSpecifier('@supabase/ssr/client')?.id).toBe('supabase');
    expect(serviceForSpecifier('react')).toBeNull();
  });

  it('classifies tests and tooling config', () => {
    expect(isTestFile('lib/date.test.ts')).toBe(true);
    expect(isTestFile('tests/e2e.ts')).toBe(true);
    expect(isTestFile('lib/date.ts')).toBe(false);
    expect(isToolingConfig('next.config.mjs')).toBe(true);
    expect(isToolingConfig('lib/site.config.ts')).toBe(false);
  });
});

describe('project detection', () => {
  it('detects Next.js projects', () => {
    expect(isNextProject(fixture('clean-app'))).toBe(true);
    expect(isNextProject(fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-empty-')))).toBe(false);
  });

  it('reads Prisma models as client accessor names', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-prisma-'));
    fs.mkdirSync(path.join(dir, 'prisma'));
    fs.writeFileSync(path.join(dir, 'prisma', 'schema.prisma'), 'model User {\n  id Int @id\n}\nmodel BlogPost {\n  id Int @id\n}\n');
    expect(readPrismaModels(dir)).toEqual(['user', 'blogPost']);
  });
});
