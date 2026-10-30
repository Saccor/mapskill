import { describe, expect, it } from 'vitest';
import { fixture } from '../test-helpers';
import { scanProject } from './scan';

describe('scanProject on clean-app', () => {
  const g = scanProject(fixture('clean-app'));
  const node = (id: string) => g.nodes.find((n) => n.id === id);
  const hasEdge = (kind: string, from: string, to: string) =>
    g.edges.some((e) => e.kind === kind && e.from === from && e.to === to);

  it('detects the framework', () => {
    expect(g.framework).toBe('nextjs');
  });

  it('creates beginner-level nodes in the right zones', () => {
    expect(node('page:app/page.tsx')).toMatchObject({ type: 'page', zone: 'pages', label: '/' });
    expect(node('layout:app/layout.tsx')).toMatchObject({ type: 'layout', zone: 'pages' });
    expect(node('api-route:app/api/profile/route.ts')).toMatchObject({ type: 'api-route', zone: 'server', label: 'GET /api/profile' });
    expect(node('component:components/ProfileCard.tsx#ProfileCard')).toMatchObject({ type: 'component', zone: 'blocks' });
    expect(node('helper:lib/profiles.ts#getProfile')).toMatchObject({ type: 'helper', zone: 'shared' });
    expect(node('file:lib/supabase.ts')).toMatchObject({ type: 'file', zone: 'shared' });
    expect(node('table:profiles')).toMatchObject({ type: 'table', zone: 'data' });
    expect(node('service:supabase')).toMatchObject({ type: 'service', zone: 'outside', label: 'Supabase' });
  });

  it('connects nodes with typed edges', () => {
    expect(hasEdge('uses', 'page:app/page.tsx', 'component:components/ProfileCard.tsx#ProfileCard')).toBe(true);
    expect(hasEdge('uses', 'page:app/page.tsx', 'helper:lib/profiles.ts#getProfile')).toBe(true);
    expect(hasEdge('uses', 'api-route:app/api/profile/route.ts', 'helper:lib/profiles.ts#getProfile')).toBe(true);
    expect(hasEdge('reads', 'helper:lib/profiles.ts#getProfile', 'table:profiles')).toBe(true);
    expect(hasEdge('uses', 'helper:lib/profiles.ts#getProfile', 'file:lib/supabase.ts')).toBe(true);
    expect(hasEdge('talks-to', 'file:lib/supabase.ts', 'service:supabase')).toBe(true);
  });

  it('records file links and gives every node a health score', () => {
    expect(g.links).toContainEqual({ from: 'app/page.tsx', to: 'components/ProfileCard.tsx', names: ['ProfileCard'], typeOnly: false });
    for (const n of g.nodes) expect(g.health[n.id]).toBe(10);
  });
});
