import fs from 'node:fs';
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
    expect(yes.items[0]).toMatchObject({ done: true, matchedNodeIds: ['api-route:a'] });
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

describe('goal file', () => {
  it('reads and writes one line', () => {
    expect(formatGoalFile('saas-auth-payments')).toBe('goal: saas-auth-payments\n');
    expect(parseGoalFile('goal: saas-auth-payments\n')).toBe('saas-auth-payments');
    expect(parseGoalFile('# comment\ngoal:   crud-app  \r\n')).toBe('crud-app');
    expect(parseGoalFile('nothing here')).toBeNull();
    expect(parseGoalFile('goal: ../../etc')).toBeNull();
  });
});
