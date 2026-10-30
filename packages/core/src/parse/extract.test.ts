import { describe, expect, it } from 'vitest';
import { extractFacts } from './extract';

describe('extractFacts: modules', () => {
  it('reads directives, imports and exports', () => {
    const f = extractFacts('app/x.tsx', `'use client';
import React, { useState as useS } from 'react';
import * as utils from '@/lib/utils';
import type { User } from './types';
import './globals.css';
export { helper } from './helper';
export default function Page() { return <div />; }
export const PI = 3.14;
export interface Props { a: string }
const local = () => 1;
export { local as renamed };
`);
    expect(f.directives).toEqual(['use client']);
    expect(f.imports.map((i) => i.specifier)).toEqual(['react', '@/lib/utils', './types', './globals.css', './helper']);
    expect(f.imports[0].bindings).toEqual([
      { imported: 'default', local: 'React' },
      { imported: 'useState', local: 'useS' },
    ]);
    expect(f.imports[1].bindings).toEqual([{ imported: '*', local: 'utils' }]);
    expect(f.imports[2].typeOnly).toBe(true);
    expect(f.imports[3].bindings).toEqual([]);
    expect(f.exports.map((e) => `${e.name}:${e.kind}`)).toEqual([
      'helper:reexport',
      'default:function',
      'PI:variable',
      'Props:type',
      'renamed:variable',
    ]);
    expect(f.functions.find((fn) => fn.name === 'Page')?.exportName).toBe('default');
    expect(f.functions.find((fn) => fn.name === 'local')?.exportName).toBe('renamed');
    expect(f.parseError).toBeUndefined();
  });

  it('unwraps memo and forwardRef', () => {
    const f = extractFacts('c.tsx', `export const Card = memo(() => <div />);`);
    expect(f.functions.map((fn) => [fn.name, fn.exportName, fn.returnsJsx])).toEqual([['Card', 'Card', true]]);
  });

  it('reports parse errors but still returns facts', () => {
    const f = extractFacts('a.ts', 'export function ok() { return 1 }\nexport function broken( {');
    expect(f.parseError).toBeDefined();
    expect(f.exports.some((e) => e.name === 'ok')).toBe(true);
  });
});

describe('extractFacts: file refs, type-only imports and exports', () => {
  it('records fileRefs from top level and type positions, not declaration names', () => {
    const f = extractFacts('lib/s.ts', `
export const userSchema = make();
export type User = Infer<typeof userSchema>;
export const url = 'x';
export const client = { url };
export const lonely = 1;
export function used() { return 1; }
export default used;`);
    expect(f.fileRefs).toContain('userSchema');
    expect(f.fileRefs).toContain('url');
    expect(f.fileRefs).toContain('used');
    expect(f.fileRefs).not.toContain('lonely');
    expect(f.fileRefs).not.toContain('client');
  });

  it('marks imports type-only when every named binding is inline-type', () => {
    const f = extractFacts('a.ts', `
import { type A } from './a';
import { type B, C } from './b';
import D, { type E } from './d';
export { type F } from './f';
export { type G, H } from './g';`);
    expect(f.imports[0]).toMatchObject({ typeOnly: true, bindings: [{ imported: 'A', local: 'A' }] });
    expect(f.imports[1]).toMatchObject({ typeOnly: false, bindings: [{ imported: 'B', local: 'B' }, { imported: 'C', local: 'C' }] });
    expect(f.imports[2].typeOnly).toBe(false);
    expect(f.imports[2].bindings.map((b) => b.imported)).toEqual(['default', 'E']);
    expect(f.imports[3].typeOnly).toBe(true);
    expect(f.imports[4]).toMatchObject({ typeOnly: false, bindings: [{ imported: 'G', local: 'G' }, { imported: 'H', local: 'H' }] });
  });

  it('records local type exports as kind type', () => {
    const f = extractFacts('t.ts', `type L = {}; type X = {}; export type { L }; export { type X };`);
    expect(f.exports.map((e) => `${e.name}:${e.kind}`)).toEqual(['L:type', 'X:type']);
  });

  it('dedupes overloaded exports by name', () => {
    const f = extractFacts('o.ts', `export function fmt(a: string): string;\nexport function fmt(a: number): string;\nexport function fmt(a: any) { return String(a); }`);
    expect(f.exports.filter((e) => e.name === 'fmt')).toHaveLength(1);
  });
});
