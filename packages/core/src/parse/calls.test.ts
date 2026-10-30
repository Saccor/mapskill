import { describe, expect, it } from 'vitest';
import { extractFacts } from './extract';

describe('calls and problems', () => {
  it('finds fetch, supabase, prisma, env and dynamic imports', () => {
    const f = extractFacts('lib/x.ts', `
export async function load(id: string) {
  await fetch('/api/items?x=1');
  await fetch(\`/api/items/\${id}\`);
  await supabase.from('profiles').select('*').eq('id', id);
  await supabase.from('orders').insert({ id });
  await prisma.user.findMany();
  await prisma.post.create({ data: {} });
  const key = process.env.STRIPE_SECRET_KEY;
  const mod = await import('./lazy');
  return Array.from([1]).map(String);
}`);
    expect(f.calls.map((c) => [c.kind, c.value, c.op ?? '', c.inFunction])).toEqual([
      ['fetch', '/api/items', '', 'load'],
      ['fetch', '/api/items/*', '', 'load'],
      ['table', 'profiles', 'read', 'load'],
      ['table', 'orders', 'write', 'load'],
      ['table', 'user', 'read', 'load'],
      ['table', 'post', 'write', 'load'],
      ['env', 'STRIPE_SECRET_KEY', '', 'load'],
    ]);
    expect(f.imports.map((i) => i.specifier)).toEqual(['./lazy']);
  });

  it('flags swallowed errors and hardcoded secrets', () => {
    const f = extractFacts('lib/y.ts', `
const stripe = new Stripe('sk_live_51HxAbCdEfGhIjKlMnOpQr');
export function a() { try { run(); } catch (e) {} }
export function b() { try { run(); } catch (e) { console.error(e); return null; } }
export function c() { try { run(); } catch (e) { throw new Error('wrapped'); } }`);
    expect(f.problems.map((p) => [p.kind, p.inFunction ?? ''])).toEqual([
      ['hardcoded-secret', ''],
      ['swallowed-error', 'a'],
      ['swallowed-error', 'b'],
    ]);
    expect(f.problems[0].detail).toBe('sk_liv…');
  });
});

describe('hardcoded-secret JWTs', () => {
  const jwt = (payload: object) =>
    ['{"alg":"HS256","typ":"JWT"}', JSON.stringify(payload)]
      .map((s) => Buffer.from(s).toString('base64url'))
      .join('.') + '.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

  it('ignores Supabase anon JWTs but reports other JWTs', () => {
    const anon = extractFacts('a.ts', `const k = '${jwt({ role: 'anon', iss: 'supabase', ref: 'abcdefghijklmnop' })}';`);
    expect(anon.problems).toEqual([]);
    const service = extractFacts('b.ts', `const k = '${jwt({ role: 'service_role', iss: 'supabase', ref: 'abcdefghijklmnop' })}';`);
    expect(service.problems.map((p) => p.kind)).toEqual(['hardcoded-secret']);
  });
});
