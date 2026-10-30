import { describe, expect, it } from 'vitest';
import { fixture } from '../test-helpers';
import { createResolver } from './resolver';

describe('createResolver', () => {
  it('resolves tsconfig path aliases and relative imports', () => {
    const r = createResolver(fixture('clean-app'));
    expect(r.resolve('@/lib/profiles', 'app/page.tsx')).toBe('lib/profiles.ts');
    expect(r.resolve('./supabase', 'lib/profiles.ts')).toBe('lib/supabase.ts');
  });

  it('returns null for packages and missing files', () => {
    const r = createResolver(fixture('clean-app'));
    expect(r.resolve('react', 'app/page.tsx')).toBeNull();
    expect(r.resolve('@/lib/missing', 'app/page.tsx')).toBeNull();
  });

  it('falls back to @/* -> ./* when there is no tsconfig', () => {
    const r = createResolver(fixture('conventions-app'));
    expect(r.resolve('@/middleware', 'app/layout.tsx')).toBe('middleware.ts');
  });
});
