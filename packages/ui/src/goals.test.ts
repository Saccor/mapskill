import type { GoalStatus, PublicGraph } from '@mapskill/core/client';
import { describe, expect, it } from 'vitest';
import { buildText, ghostItem, ghostNodes, goalLine, withGhosts } from './goals';

const status: GoalStatus = {
  goalId: 'saas-auth-payments',
  title: { en: 'SaaS with login and payments', sv: 'SaaS med inloggning och betalning' },
  done: 1,
  total: 3,
  items: [
    { id: 'home-page', title: { en: 'Home page', sv: 'Startsida' }, why: { en: 'w', sv: 'w' }, done: true, nodeType: 'page', zone: 'pages', matchedNodeIds: ['page:app/page.tsx'] },
    {
      id: 'checkout', title: { en: 'Checkout endpoint', sv: 'API för betalning' },
      why: { en: 'Customers need a way to start a payment.', sv: 'Kunden behöver ett sätt att starta en betalning.' },
      done: false, nodeType: 'api-route', zone: 'server', suggestPath: 'app/api/checkout/route.ts', matchedNodeIds: [],
    },
    { id: 'no-secrets', title: { en: 'No secret keys in the code', sv: 'Inga hemliga nycklar i koden' }, why: { en: 'w', sv: 'w' }, done: false, matchedNodeIds: [] },
  ],
};
const graph: PublicGraph = {
  root: '/p', framework: 'nextjs', findings: [], health: {}, fileCount: 2, unreadableFiles: [], edges: [],
  nodes: [
    { id: 'page:app/page.tsx', type: 'page', zone: 'pages', label: '/', file: 'app/page.tsx', route: '/' },
    { id: 'api-route:b', type: 'api-route', zone: 'server', label: 'GET /api/profile', file: 'b', route: '/api/profile' },
    { id: 'api-route:a', type: 'api-route', zone: 'server', label: 'GET /api/account', file: 'a', route: '/api/account' },
  ],
};

describe('goals in the map', () => {
  it('turns missing items with a node type into planned parts', () => {
    expect(ghostNodes(status, 'sv')).toEqual([{ id: 'ghost:checkout', type: 'api-route', zone: 'server', label: 'API för betalning', planned: true }]);
    expect(ghostNodes(null, 'sv')).toEqual([]);
    const shown = withGhosts(graph, status, 'en');
    expect(shown.nodes.map((n) => n.id)).toEqual(['page:app/page.tsx', 'api-route:b', 'api-route:a', 'ghost:checkout']);
    expect(withGhosts(graph, null, 'en')).toBe(graph);
    expect(ghostItem(status, 'ghost:checkout')?.id).toBe('checkout');
    expect(ghostItem(status, 'page:app/page.tsx')).toBeNull();
  });

  it('writes the progress line and a build request in the chosen language', () => {
    expect(goalLine(status, 'sv')).toBe('Mål: SaaS med inloggning och betalning (1/3)');
    const item = status.items[1];
    expect(buildText(item, graph, 'sv')).toBe(
      'Lägg till API för betalning (Kunden behöver ett sätt att starta en betalning). Föreslagen plats: app/api/checkout/route.ts. ' +
        'Återanvänd det som redan finns, till exempel GET /api/account, GET /api/profile.',
    );
    expect(buildText({ ...item, suggestPath: undefined }, { ...graph, nodes: [] }, 'en')).toBe(
      'Add Checkout endpoint (Customers need a way to start a payment).',
    );
  });
});
