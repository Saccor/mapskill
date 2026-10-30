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
