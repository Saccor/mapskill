import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { functionMetrics, type FnNode } from './functions';

function metrics(code: string) {
  const sf = ts.createSourceFile('t.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const st = sf.statements[0];
  if (ts.isFunctionDeclaration(st)) return functionMetrics(sf, st.name!.text, st);
  if (ts.isVariableStatement(st)) {
    const d = st.declarationList.declarations[0];
    return functionMetrics(sf, (d.name as ts.Identifier).text, d.initializer as FnNode);
  }
  throw new Error('no function in snippet');
}

describe('functionMetrics', () => {
  it('counts statements and detects JSX', () => {
    const m = metrics(`function Card({ a }: { a: string }) { const b = a.trim(); if (b) { return <p>{b}</p>; } return null; }`);
    expect(m.statements).toBe(4);
    expect(m.returnsJsx).toBe(true);
    expect(m.startLine).toBe(1);
  });

  it('gives renamed copies the same renamedHash but a different exactHash', () => {
    const a = metrics(`function f(x: number) { const y = x * 2; return y + 1; }`);
    const b = metrics(`function g(p: number) { const q = p * 2; return q + 1; }`);
    const c = metrics(`function h(x: number) { const y = x * 2; return y + 1; }`);
    expect(a.renamedHash).toBe(b.renamedHash);
    expect(a.exactHash).not.toBe(b.exactHash);
    expect(a.exactHash).toBe(c.exactHash);
  });

  it('ignores comments', () => {
    const a = metrics(`function f(x: number) { /* hi */ return x; // yo\n }`);
    const b = metrics(`function f(x: number) { return x; }`);
    expect(a.exactHash).toBe(b.exactHash);
  });

  it('scores cognitive complexity and nesting', () => {
    const a = metrics(`function f(a: boolean, b: boolean) { if (a) { if (b) { return 1; } } else { return 2; } return 3; }`);
    expect(a.cognitive).toBe(4);
    expect(a.maxNesting).toBe(2);
    const b = metrics(`function f(xs: number[]) { for (const x of xs) { if (x > 1 && x < 5) { return x; } } return 0; }`);
    expect(b.cognitive).toBe(4);
    expect(b.maxNesting).toBe(2);
  });

  it('collects referenced identifiers but not property names', () => {
    const m = metrics(`function f() { return helper(api.get(1)); }`);
    expect(m.refs).toEqual(['api', 'helper']);
  });

  it('handles arrow functions with expression bodies', () => {
    const m = metrics(`const Box = () => <div className="a">{1}</div>;`);
    expect(m.returnsJsx).toBe(true);
    expect(m.statements).toBe(1);
    expect(m.shingles.length).toBeGreaterThan(0);
  });
});
