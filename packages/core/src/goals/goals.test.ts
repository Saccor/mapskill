import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toPublicGraph, type PublicGraph } from '../graph/delta';
import { scanProject } from '../graph/scan';
import { fixture } from '../test-helpers';
import { BUILTIN_GOALS } from './builtin';
import { evaluateGoal, findGoal, goalSummaries } from './evaluate';
import { formatGoalFile, parseGoalFile } from './goal-file';
import type { GoalTemplate } from './types';

const onDisk = (root: string) => (rel: string) => fs.existsSync(path.join(root, rel));
const status = (fixtureName: string, goalId: string) => {
  const root = fixture(fixtureName);
  return evaluateGoal(findGoal(goalId)!, toPublicGraph(scanProject(root)), onDisk(root));
};

const g = (over: Partial<PublicGraph>): PublicGraph => ({
  root: '/p', framework: 'nextjs', nodes: [], edges: [], findings: [], health: {}, fileCount: 0, unreadableFiles: [], ...over,
});

describe('built-in goals', () => {
  it('has four goals with unique item ids and texts in both languages', () => {
    expect(goalSummaries().map((s) => s.id)).toEqual(['landing-page', 'webapp-auth', 'saas-auth-payments', 'crud-app']);
    for (const t of BUILTIN_GOALS) {
      const resolved = findGoal(t.id)!;
      const ids = resolved.items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const i of resolved.items) {
        expect(i.title.en && i.title.sv && i.why.en && i.why.sv).toBeTruthy();
      }
    }
  });

  it('half-saas misses exactly the payment parts of the SaaS goal', () => {
    const s = status('half-saas', 'saas-auth-payments');
    expect(s.items.filter((i) => !i.done).map((i) => i.id)).toEqual(['pricing-page', 'checkout', 'webhook', 'subscriptions-table']);
    expect(s.done).toBe(s.total - 4);
    const checkout = s.items.find((i) => i.id === 'checkout')!;
    expect(checkout).toMatchObject({ nodeType: 'api-route', zone: 'server', suggestPath: 'app/api/checkout/route.ts' });
  });

  it('half-saas meets the whole web-app-with-login goal', () => {
    const s = status('half-saas', 'webapp-auth');
    expect(s.items.filter((i) => !i.done).map((i) => i.id)).toEqual([]);
    expect(s.items.find((i) => i.id === 'login-page')!.matchedNodeIds).toEqual(['page:app/login/page.tsx']);
  });

  it('clean-app has a home page and a layout but no login', () => {
    const s = status('clean-app', 'webapp-auth');
    const done = new Set(s.items.filter((i) => i.done).map((i) => i.id));
    expect(done.has('home-page')).toBe(true);
    expect(done.has('root-layout')).toBe(true);
    expect(done.has('login-page')).toBe(false);
  });
});

describe('evaluateGoal checks', () => {
  const t = (items: GoalTemplate['items']): GoalTemplate => ({ id: 't', title: { en: 't', sv: 't' }, description: { en: '', sv: '' }, items });
  const item = (check: GoalTemplate['items'][number]['check']) => ({ id: 'i', title: { en: 'i', sv: 'i' }, why: { en: 'w', sv: 'w' }, check });

  it('follows uses edges up to three steps for talksTo and touchesTable', () => {
    const graph = g({
      nodes: [
        { id: 'api-route:a', type: 'api-route', zone: 'server', label: 'POST /api/checkout', route: '/api/checkout', file: 'a' },
        { id: 'helper:b#b', type: 'helper', zone: 'shared', label: 'b', file: 'b' },
        { id: 'helper:c#c', type: 'helper', zone: 'shared', label: 'c', file: 'c' },
        { id: 'service:stripe', type: 'service', zone: 'outside', label: 'Stripe' },
        { id: 'table:subscriptions', type: 'table', zone: 'data', label: 'subscriptions' },
      ],
      edges: [
        { id: 'e1', from: 'api-route:a', to: 'helper:b#b', kind: 'uses' },
        { id: 'e2', from: 'helper:b#b', to: 'helper:c#c', kind: 'uses' },
        { id: 'e3', from: 'helper:c#c', to: 'service:stripe', kind: 'talks-to' },
        { id: 'e4', from: 'helper:c#c', to: 'table:subscriptions', kind: 'writes' },
      ],
    });
    const yes = evaluateGoal(t([item({ anyNode: { type: 'api-route', talksTo: 'stripe', touchesTable: '^subscriptions$' } })]), graph, () => false);
    expect(yes.items[0]).toMatchObject({ done: true, matchedNodeIds: ['table:subscriptions', 'api-route:a'] });
    const far = g({ ...graph, edges: [{ id: 'x', from: 'api-route:a', to: 'helper:b#b', kind: 'uses' }] });
    expect(evaluateGoal(t([item({ anyNode: { type: 'api-route', talksTo: 'stripe' } })]), far, () => false).items[0].done).toBe(false);
  });

  it('combines checks, reads files through the callback and never throws on a bad regex', () => {
    const graph = g({ nodes: [{ id: 'page:p', type: 'page', zone: 'pages', label: '/Login', route: '/Login', file: 'p' }] });
    const s = evaluateGoal(
      t([
        { ...item({ any: [{ fileExists: 'nope' }, { anyNode: { routeMatches: '^/login$' } }] }), id: 'a' },
        { ...item({ all: [{ fileExists: '.env.example' }, { noFindings: 'hardcoded-secret' }] }), id: 'b' },
        { ...item({ anyNode: { nameMatches: '(' } }), id: 'c' },
        { ...item({ all: [] }), id: 'd' },
        { ...item({ any: [] }), id: 'e' },
      ]),
      graph,
      (rel) => rel === '.env.example',
    );
    expect(s.items.map((i) => [i.id, i.done])).toEqual([['a', true], ['b', true], ['c', false], ['d', true], ['e', false]]);
    expect(s.done).toBe(3);
  });

  it('ignores planned nodes', () => {
    const graph = g({ nodes: [{ id: 'ghost:x', type: 'page', zone: 'pages', label: '/login', route: '/login', planned: true }] });
    expect(evaluateGoal(t([item({ anyNode: { type: 'page' } })]), graph, () => false).items[0].done).toBe(false);
  });

  it('resolves extends with parent items first and child overrides in place, and rejects cycles', () => {
    const parent: GoalTemplate = { id: 'p', title: { en: 'p', sv: 'p' }, description: { en: '', sv: '' }, items: [{ ...item({ all: [] }), id: 'x' }, { ...item({ all: [] }), id: 'y' }] };
    const child: GoalTemplate = { id: 'c', title: { en: 'c', sv: 'c' }, description: { en: '', sv: '' }, extends: 'p', items: [{ ...item({ any: [] }), id: 'x' }, { ...item({ all: [] }), id: 'z' }] };
    expect(findGoal('c', [parent, child])!.items.map((i) => [i.id, 'any' in i.check])).toEqual([['x', true], ['y', false], ['z', false]]);
    expect(findGoal('missing', [parent])).toBeNull();
    expect(() => findGoal('a', [{ ...parent, id: 'a', extends: 'b' }, { ...parent, id: 'b', extends: 'a' }])).toThrow(/cycle/);
  });
});

describe('evaluateGoal fix round 1', () => {
  const node = (id: string, type: 'page' | 'api-route' | 'table' | 'service' | 'helper', extra: object = {}) => ({
    id, type, zone: ({ page: 'pages', 'api-route': 'server', table: 'data', service: 'outside', helper: 'shared' } as const)[type], label: id, ...extra,
  });
  const only = (goalId: string, itemId: string, graph: PublicGraph) =>
    evaluateGoal(findGoal(goalId)!, graph, () => false).items.find((i) => i.id === itemId)!;

  it('accepts singular (Prisma-style) table names', () => {
    const graph = g({
      nodes: [node('page:a', 'page', { route: '/account' }), node('api-route:s', 'api-route', { route: '/api/s' }), node('table:user', 'table'), node('table:subscription', 'table')],
      edges: [
        { id: 'e1', from: 'page:a', to: 'table:user', kind: 'reads' },
        { id: 'e2', from: 'api-route:s', to: 'table:subscription', kind: 'writes' },
      ],
    });
    expect(only('webapp-auth', 'users-table', graph).done).toBe(true);
    expect(only('saas-auth-payments', 'subscriptions-table', graph).done).toBe(true);
  });

  it('matches whole route segments only', () => {
    const page = (route: string) => g({ nodes: [node('page:x', 'page', { route })] });
    expect(only('saas-auth-payments', 'pricing-page', page('/enterprise')).done).toBe(false);
    expect(only('saas-auth-payments', 'pricing-page', page('/company')).done).toBe(false);
    expect(only('saas-auth-payments', 'pricing-page', page('/pricing')).done).toBe(true);
    expect(only('webapp-auth', 'login-page', page('/login')).done).toBe(true);
    expect(only('webapp-auth', 'login-page', page('/blogin')).done).toBe(false);
    expect(only('landing-page', 'contact', page('/news')).done).toBe(false);
    expect(only('crud-app', 'create', page('/items/new')).done).toBe(true);
    expect(only('crud-app', 'create', page('/news')).done).toBe(false);
    expect(only('crud-app', 'edit', page('/items/[id]/edit')).done).toBe(true);
    expect(only('crud-app', 'edit', page('/blog/[slug]')).done).toBe(false);
  });

  it('follows calls-api edges too for talksTo and touchesTable', () => {
    const graph = g({
      nodes: [node('page:l', 'page', { route: '/items' }), node('api-route:i', 'api-route', { route: '/api/items' }), node('table:items', 'table'), node('service:stripe', 'service')],
      edges: [
        { id: 'e1', from: 'page:l', to: 'api-route:i', kind: 'calls-api' },
        { id: 'e2', from: 'api-route:i', to: 'table:items', kind: 'reads' },
        { id: 'e3', from: 'api-route:i', to: 'service:stripe', kind: 'talks-to' },
      ],
    });
    expect(only('crud-app', 'list-page', graph)).toMatchObject({ done: true, matchedNodeIds: ['table:items', 'page:l'] });
    const t: GoalTemplate = { id: 't', title: { en: 't', sv: 't' }, description: { en: '', sv: '' }, items: [{ id: 'i', title: { en: 'i', sv: 'i' }, why: { en: 'w', sv: 'w' }, check: { anyNode: { type: 'page', talksTo: 'stripe' } } }] };
    expect(evaluateGoal(t, graph, () => false).items[0].done).toBe(true);
  });

  it('evaluates a 1500-node graph with 6000 edges quickly', () => {
    const N = 1500;
    const nodes = Array.from({ length: N }, (_, i) => node(`helper:n${i}`, 'helper', { route: `/r${i}` }));
    const edges: PublicGraph['edges'] = [];
    for (let i = 0; i < N; i++) for (let k = 1; k <= 4; k++) edges.push({ id: `e${i}-${k}`, from: `helper:n${i}`, to: `helper:n${(i * 4 + k) % N}`, kind: 'uses' });
    const graph = g({ nodes, edges });
    const start = performance.now();
    const s = evaluateGoal(findGoal('saas-auth-payments')!, graph, () => false);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(s.total).toBeGreaterThan(0);
  });
});

describe('protect-pages item', () => {
  const protect = (graph: PublicGraph) => evaluateGoal(findGoal('webapp-auth')!, graph, () => false).items.find((i) => i.id === 'protect-pages')!;
  const scanned = (files: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-protect-'));
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', dependencies: { next: '15.0.0' } }));
      for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
      }
      return protect(toPublicGraph(scanProject(root)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  it('is done for a middleware node whatever the extension, and not done without one', () => {
    const cfg = g({ nodes: [{ id: 'config:middleware.js', type: 'config', zone: 'server', label: 'middleware', file: 'middleware.js' }] });
    expect(protect(cfg)).toMatchObject({ done: true, matchedNodeIds: ['config:middleware.js'] });
    expect(protect(g({}))).toMatchObject({ done: false, suggestPath: 'middleware.ts' });
  });

  it('counts a real middleware.js and a real src/proxy.ts as done', () => {
    expect(scanned({ 'app/page.tsx': 'export default function P(){return null}', 'middleware.js': 'export function middleware(){}' }).done).toBe(true);
    expect(scanned({ 'app/page.tsx': 'export default function P(){return null}', 'src/proxy.ts': 'export function proxy(){}' }).done).toBe(true);
  });
});

describe('touchesTable matches', () => {
  it('lists the matched table nodes first, sorted, within the cap', () => {
    const nodes: PublicGraph['nodes'] = [
      { id: 'page:l', type: 'page', zone: 'pages', label: '/l', route: '/l', file: 'l' },
      { id: 'table:subscriptions', type: 'table', zone: 'data', label: 'subscriptions' },
      { id: 'table:customers', type: 'table', zone: 'data', label: 'customers' },
      { id: 'table:posts', type: 'table', zone: 'data', label: 'posts' },
    ];
    const edges: PublicGraph['edges'] = [
      { id: 'e1', from: 'page:l', to: 'table:subscriptions', kind: 'reads' },
      { id: 'e2', from: 'page:l', to: 'table:customers', kind: 'writes' },
      { id: 'e3', from: 'page:l', to: 'table:posts', kind: 'reads' },
    ];
    const s = evaluateGoal(findGoal('saas-auth-payments')!, g({ nodes, edges }), () => false);
    expect(s.items.find((i) => i.id === 'subscriptions-table')).toMatchObject({ done: true, matchedNodeIds: ['table:customers', 'table:subscriptions', 'page:l'] });
  });
});

describe('goal file', () => {
  it('reads and writes one line', () => {
    expect(formatGoalFile('saas-auth-payments')).toBe('goal: saas-auth-payments\n');
    expect(parseGoalFile('goal: saas-auth-payments\n')).toBe('saas-auth-payments');
    expect(parseGoalFile('# comment\ngoal:   crud-app  \r\n')).toBe('crud-app');
    expect(parseGoalFile('nothing here')).toBeNull();
    expect(parseGoalFile('goal: ../../etc')).toBeNull();
  });
});
