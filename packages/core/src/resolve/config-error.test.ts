import { describe, expect, it } from 'vitest';
import { tmpProject } from '../test-helpers';
import { createResolver } from './resolver';

describe('createResolver config errors', () => {
  it('exposes a configError and still falls back when tsconfig is broken', () => {
    const root = tmpProject({ 'tsconfig.json': '{ "compilerOptions": ', 'src/a.ts': 'export {};', 'src/b.ts': 'export {};' });
    const r = createResolver(root);
    expect(r.configError).toBeTruthy();
    expect(r.resolve('@/b', 'src/a.ts')).toBe('src/b.ts');
  });
});
