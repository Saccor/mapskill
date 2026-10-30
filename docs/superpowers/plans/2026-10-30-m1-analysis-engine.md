# Mapskill M1: analysmotor och `mapskill scan` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bygg en lokal analysmotor som läser ett Next.js/TypeScript-projekt och producerar en graf av nybörjarbegrepp (sidor, API-rutter, komponenter, tabeller, tjänster) plus fynd (dubbletter, oanvänd kod, strukturbrott), och ett CLI `mapskill scan` som skriver ut resultatet.

**Architecture:** Ren TypeScript utan native-beroenden. Varje fil parsas med TypeScripts egen parser till `FileFacts`. Importer löses med `ts.resolveModuleName` och projektets tsconfig. En adapter gör om filfakta till noder och kanter. Oberoende analysmoduler tar en `AnalysisContext` och returnerar `Finding[]`. Allt är synkront och deterministiskt; ingen LLM, inget nätverk.

**Tech Stack:** Node 22, pnpm-arbetsyta, TypeScript `~5.9.3` (både som verktyg och som parser-API), `ignore` för `.gitignore`, Vitest, tsx.

Spec: [../specs/2026-10-30-mapskill-mvp-design.md](../specs/2026-10-30-mapskill-mvp-design.md). Färdplan: [2026-10-30-mapskill-roadmap.md](2026-10-30-mapskill-roadmap.md).

## Global Constraints

- Node `>=22`. pnpm `>=10`.
- `typescript` låst till `~5.9.3` som körberoende i `@mapskill/core`. Använd inte TypeScript 7 (Go-porten har ett annat API).
- Inga native-beroenden i `@mapskill/core` eller `mapskill` (måste installeras på Windows utan byggverktyg).
- Alla sökvägar i datamodellen är relativa till projektroten och använder `/` även på Windows.
- All text som visas för användaren är `{ en: string; sv: string }`.
- Ingen nätverkstrafik, ingen LLM.
- Säkerhet för fynd följer specens tabell 3.4 exakt. Säkra fynd får aldrig uppstå i `fixtures/clean-app` eller `fixtures/conventions-app`.
- Tröskelvärden: dubbletter minst 5 satser; nästan-dubbletter minst 8 satser och Jaccard minst 0,8; krånglig funktion när kognitiv komplexitet > 15 eller nästling > 4; lång fil > 400 rader.
- Modulsystem: ESM (`"type": "module"`), importer utan filändelse, `moduleResolution: "Bundler"`.

---

## Filstruktur

```
package.json                     rotskript och dev-beroenden
pnpm-workspace.yaml
tsconfig.json                    typkontroll av alla paket (fixtures exkluderas)
vitest.config.ts
.gitignore
packages/core/
  package.json
  src/
    index.ts                     publikt API
    test-helpers.ts              fixture(name) -> absolut sökväg
    util/hash.ts                 sha1, fnv1a
    model/types.ts               alla datatyper
    parse/functions.ts           mått per funktion
    parse/extract.ts             FileFacts: direktiv, importer, exporter, funktioner
    parse/calls.ts               fetch, tabeller, env, problem
    resolve/resolver.ts          tsconfig + resolveModuleName
    scan/files.ts                lista källfiler med .gitignore
    adapters/file-kinds.ts       isTestFile, isToolingConfig
    adapters/nextjs/routes.ts    rutter från filsökvägar
    adapters/nextjs/services.ts  kända SDK:er
    adapters/nextjs/project.ts   isNextProject, readPrismaModels
    adapters/build-model.ts      noder, kanter, owner()
    analyze/context.ts           AnalysisContext, makeFinding
    analyze/duplicates.ts
    analyze/unused.ts
    analyze/cycles.ts
    analyze/rules.ts
    analyze/health.ts
    analyze/index.ts             runAnalyzers
    graph/scan.ts                scanProject(root): Graph
    text/messages.ts             klarspråk en/sv
    text/labels.ts               zonnamn en/sv
packages/cli/
  package.json
  src/
    bin.ts
    scan.ts                      runScan, formatSummary
fixtures/
  clean-app/                     korrekt app, inga säkra fynd
  messy-app/                     planterade problem
  conventions-app/               alla Next.js-konventioner, ingen tsconfig
```

---

### Task 1: Arbetsyta, datamodell och funktionsmått

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/src/model/types.ts`, `packages/core/src/util/hash.ts`, `packages/core/src/parse/functions.ts`
- Test: `packages/core/src/parse/functions.test.ts`

**Interfaces:**
- Consumes: inget.
- Produces: alla typer i `model/types.ts`; `sha1(text: string): string`; `fnv1a(text: string): number`; `functionMetrics(sf: ts.SourceFile, name: string, node: FnNode, exportName?: string): FunctionFact`; `type FnNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction`.

- [ ] **Step 1: Initiera git och arbetsytan**

```bash
cd C:/Users/sacco/Desktop/Mapskill
git init
```

`package.json`:

```json
{
  "name": "mapskill-workspace",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "scan": "tsx packages/cli/src/bin.ts scan"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.20.0",
    "typescript": "~5.9.3",
    "vitest": "^3.2.4"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["packages/*/src", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/src/**/*.test.ts'] },
});
```

`.gitignore`:

```
node_modules/
dist/
.mapskill/
```

`packages/core/package.json`:

```json
{
  "name": "@mapskill/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "ignore": "^7.0.5",
    "typescript": "~5.9.3"
  }
}
```

Run: `pnpm install`
Expected: installs without errors, creates `pnpm-lock.yaml`.

- [ ] **Step 2: Skriv datamodellen**

`packages/core/src/model/types.ts`:

```ts
export type Framework = 'nextjs' | 'generic';

export type NodeType =
  | 'page' | 'layout' | 'api-route' | 'server-action' | 'component'
  | 'helper' | 'table' | 'service' | 'test' | 'config' | 'file';

export type Zone = 'pages' | 'blocks' | 'server' | 'data' | 'shared' | 'outside' | 'tests';

export interface Text { en: string; sv: string }

export interface ImportBinding { imported: string; local: string }

export interface ImportFact {
  specifier: string;
  /** imported: 'default', '*', or the exported name. Empty for side-effect imports. */
  bindings: ImportBinding[];
  typeOnly: boolean;
  line: number;
}

export interface ExportFact {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'reexport';
  line: number;
}

export interface FunctionFact {
  name: string;
  /** Name under which the function is exported ('default' for default export). */
  exportName?: string;
  startLine: number;
  endLine: number;
  returnsJsx: boolean;
  statements: number;
  exactHash: string;
  renamedHash: string;
  shingles: number[];
  cognitive: number;
  maxNesting: number;
  /** Identifiers referenced in the body, excluding property names. Sorted, unique. */
  refs: string[];
}

export interface CallFact {
  kind: 'fetch' | 'table' | 'env';
  value: string;
  op?: 'read' | 'write';
  line: number;
  inFunction?: string;
}

export interface ProblemFact {
  kind: 'swallowed-error' | 'hardcoded-secret';
  line: number;
  detail?: string;
  inFunction?: string;
}

export interface FileFacts {
  path: string;
  hash: string;
  lines: number;
  mtimeMs: number;
  directives: string[];
  imports: ImportFact[];
  exports: ExportFact[];
  functions: FunctionFact[];
  calls: CallFact[];
  problems: ProblemFact[];
  parseError?: string;
}

export interface FileLink { from: string; to: string; names: string[]; typeOnly: boolean }

export interface MapNode {
  id: string;
  type: NodeType;
  zone: Zone;
  label: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  route?: string;
  planned?: boolean;
}

export type EdgeKind = 'uses' | 'calls-api' | 'reads' | 'writes' | 'talks-to' | 'tests';

export interface MapEdge { id: string; from: string; to: string; kind: EdgeKind }

export type FindingKind =
  | 'exact-duplicate' | 'renamed-duplicate' | 'near-duplicate'
  | 'unused-export' | 'orphan-file'
  | 'complex-function' | 'long-file'
  | 'client-touches-server' | 'page-touches-table' | 'circular-import'
  | 'hardcoded-secret' | 'swallowed-error';

export type Certainty = 'certain' | 'likely';

export interface Finding {
  id: string;
  kind: FindingKind;
  certainty: Certainty;
  nodeIds: string[];
  files: string[];
  message: Text;
  /** Ready-made instruction for Claude, in English. */
  instruction: string;
}

export interface Graph {
  root: string;
  framework: Framework;
  files: Record<string, FileFacts>;
  links: FileLink[];
  nodes: MapNode[];
  edges: MapEdge[];
  findings: Finding[];
  health: Record<string, number>;
}
```

`packages/core/src/util/hash.ts`:

```ts
import { createHash } from 'node:crypto';

export function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
```

- [ ] **Step 3: Skriv det fallerande testet för funktionsmått**

`packages/core/src/parse/functions.test.ts`:

```ts
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
```

- [ ] **Step 4: Kör testet och se att det fallerar**

Run: `pnpm vitest run packages/core/src/parse/functions.test.ts`
Expected: FAIL, cannot resolve `./functions`.

- [ ] **Step 5: Implementera funktionsmått**

`packages/core/src/parse/functions.ts`:

```ts
import ts from 'typescript';
import type { FunctionFact } from '../model/types';
import { fnv1a, sha1 } from '../util/hash';

export type FnNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
]);

const LOGICAL = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

export function functionMetrics(sf: ts.SourceFile, name: string, node: FnNode, exportName?: string): FunctionFact {
  const tokens: ts.Node[] = [];
  for (const p of node.parameters) leafTokens(p, sf, tokens);
  if (node.body) leafTokens(node.body, sf, tokens);
  const exact = tokens.map((t) => t.getText(sf));
  const renamed = tokens.map((t) =>
    t.kind === ts.SyntaxKind.Identifier || t.kind === ts.SyntaxKind.PrivateIdentifier
      ? 'ID'
      : LITERAL_KINDS.has(t.kind)
        ? 'LIT'
        : t.getText(sf),
  );
  const body = node.body;
  const { cognitive, maxNesting } = body ? complexity(body) : { cognitive: 0, maxNesting: 0 };
  return {
    name,
    exportName,
    startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
    returnsJsx: body ? containsJsx(body) : false,
    statements: body ? countStatements(body) : 0,
    exactHash: sha1(exact.join('\u0001')),
    renamedHash: sha1(renamed.join('\u0001')),
    shingles: shingles(renamed, 5),
    cognitive,
    maxNesting,
    refs: body ? collectRefs(body) : [],
  };
}

function leafTokens(node: ts.Node, sf: ts.SourceFile, out: ts.Node[]): void {
  if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
  const children = node.getChildren(sf);
  if (children.length === 0) {
    if (node.kind === ts.SyntaxKind.SyntaxList || node.kind === ts.SyntaxKind.EndOfFileToken) return;
    if (node.kind === ts.SyntaxKind.JsxText && (node as ts.JsxText).containsOnlyTriviaWhiteSpaces) return;
    out.push(node);
    return;
  }
  for (const c of children) leafTokens(c, sf, out);
}

function countStatements(body: ts.Node): number {
  let n = ts.isBlock(body) ? 0 : 1;
  const visit = (x: ts.Node): void => {
    if (x.kind >= ts.SyntaxKind.FirstStatement && x.kind <= ts.SyntaxKind.LastStatement) n++;
    ts.forEachChild(x, visit);
  };
  ts.forEachChild(body, visit);
  return n;
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (x: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) {
      found = true;
      return;
    }
    ts.forEachChild(x, visit);
  };
  visit(node);
  return found;
}

function collectRefs(body: ts.Node): string[] {
  const set = new Set<string>();
  const visit = (x: ts.Node): void => {
    if (ts.isIdentifier(x)) {
      const p = x.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(p) && p.name === x) ||
        (ts.isPropertyAssignment(p) && p.name === x) ||
        (ts.isJsxAttribute(p) && p.name === x);
      if (!isPropertyName) set.add(x.text);
    }
    ts.forEachChild(x, visit);
  };
  visit(body);
  return [...set].sort();
}

function complexity(body: ts.Node): { cognitive: number; maxNesting: number } {
  let score = 0;
  let maxNesting = 0;
  const deeper = (n: number): number => {
    maxNesting = Math.max(maxNesting, n);
    return n;
  };
  const visit = (node: ts.Node, nesting: number): void => {
    if (ts.isIfStatement(node)) {
      const isElseIf = ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
      score += isElseIf ? 1 : 1 + nesting;
      visit(node.expression, nesting);
      visit(node.thenStatement, deeper(nesting + 1));
      if (node.elseStatement) {
        if (ts.isIfStatement(node.elseStatement)) {
          visit(node.elseStatement, nesting);
        } else {
          score += 1;
          visit(node.elseStatement, deeper(nesting + 1));
        }
      }
      return;
    }
    if (
      ts.isIterationStatement(node, false) ||
      ts.isSwitchStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isConditionalExpression(node)
    ) {
      score += 1 + nesting;
      const inner = deeper(nesting + 1);
      ts.forEachChild(node, (c) => visit(c, inner));
      return;
    }
    if (ts.isFunctionLike(node)) {
      ts.forEachChild(node, (c) => visit(c, nesting + 1));
      return;
    }
    if (ts.isBinaryExpression(node) && LOGICAL.has(node.operatorToken.kind)) {
      const p = node.parent;
      if (!(ts.isBinaryExpression(p) && p.operatorToken.kind === node.operatorToken.kind)) score += 1;
    }
    ts.forEachChild(node, (c) => visit(c, nesting));
  };
  if (ts.isBlock(body)) ts.forEachChild(body, (c) => visit(c, 0));
  else visit(body, 0);
  return { cognitive: score, maxNesting };
}

function shingles(tokens: string[], size: number): number[] {
  const set = new Set<number>();
  for (let i = 0; i + size <= tokens.length; i++) set.add(fnv1a(tokens.slice(i, i + size).join('\u0001')));
  return [...set];
}
```

- [ ] **Step 6: Kör testet och se att det passerar**

Run: `pnpm vitest run packages/core/src/parse/functions.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore packages/core
git commit -m "feat(core): workspace, data model and per-function metrics"
```

---

### Task 2: Filfakta (direktiv, importer, exporter, funktioner)

**Files:**
- Create: `packages/core/src/parse/extract.ts`
- Test: `packages/core/src/parse/extract.test.ts`

**Interfaces:**
- Consumes: `functionMetrics`, `FnNode` (Task 1); typer `FileFacts`, `ImportFact`, `ImportBinding` (Task 1); `sha1` (Task 1).
- Produces: `extractFacts(path: string, text: string, mtimeMs?: number): FileFacts`; `scriptKindFor(path: string): ts.ScriptKind`.

- [ ] **Step 1: Skriv det fallerande testet**

`packages/core/src/parse/extract.test.ts`:

```ts
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
```

- [ ] **Step 2: Kör testet och se att det fallerar**

Run: `pnpm vitest run packages/core/src/parse/extract.test.ts`
Expected: FAIL, cannot resolve `./extract`.

- [ ] **Step 3: Implementera**

`packages/core/src/parse/extract.ts`:

```ts
import ts from 'typescript';
import type { FileFacts, ImportBinding, ImportFact } from '../model/types';
import { sha1 } from '../util/hash';
import { functionMetrics, type FnNode } from './functions';

export function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const WRAPPERS = new Set(['memo', 'forwardRef', 'useCallback']);

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function unwrapFunction(e: ts.Expression): FnNode | undefined {
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return unwrapFunction(e.expression);
  if (ts.isCallExpression(e) && e.arguments[0]) {
    const callee = e.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
    if (WRAPPERS.has(name)) return unwrapFunction(e.arguments[0]);
  }
  return undefined;
}

function importFact(st: ts.ImportDeclaration, line: number): ImportFact {
  const clause = st.importClause;
  const bindings: ImportBinding[] = [];
  if (clause?.name) bindings.push({ imported: 'default', local: clause.name.text });
  const nb = clause?.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) bindings.push({ imported: '*', local: nb.name.text });
  if (nb && ts.isNamedImports(nb)) {
    for (const el of nb.elements) bindings.push({ imported: (el.propertyName ?? el.name).text, local: el.name.text });
  }
  return { specifier: (st.moduleSpecifier as ts.StringLiteral).text, bindings, typeOnly: !!clause?.isTypeOnly, line };
}

function handleExportDeclaration(
  st: ts.ExportDeclaration,
  facts: FileFacts,
  exportedLocals: Map<string, string>,
  line: number,
): void {
  const clause = st.exportClause;
  if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
    const bindings: ImportBinding[] = [];
    if (!clause) {
      bindings.push({ imported: '*', local: '*' });
      facts.exports.push({ name: '*', kind: 'reexport', line });
    } else if (ts.isNamespaceExport(clause)) {
      bindings.push({ imported: '*', local: clause.name.text });
      facts.exports.push({ name: clause.name.text, kind: 'reexport', line });
    } else {
      for (const el of clause.elements) {
        bindings.push({ imported: (el.propertyName ?? el.name).text, local: el.name.text });
        facts.exports.push({ name: el.name.text, kind: 'reexport', line });
      }
    }
    facts.imports.push({ specifier: st.moduleSpecifier.text, bindings, typeOnly: st.isTypeOnly, line });
  } else if (clause && ts.isNamedExports(clause)) {
    for (const el of clause.elements) {
      facts.exports.push({ name: el.name.text, kind: 'variable', line });
      exportedLocals.set((el.propertyName ?? el.name).text, el.name.text);
    }
  }
}

export function extractFacts(path: string, text: string, mtimeMs = 0): FileFacts {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  const facts: FileFacts = {
    path,
    hash: sha1(text),
    lines: text.split('\n').length,
    mtimeMs,
    directives: [],
    imports: [],
    exports: [],
    functions: [],
    calls: [],
    problems: [],
  };
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diags.length > 0) facts.parseError = ts.flattenDiagnosticMessageText(diags[0].messageText, ' ');
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const exportedLocals = new Map<string, string>();

  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) facts.directives.push(st.expression.text);
    else break;
  }

  for (const st of sf.statements) {
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      facts.imports.push(importFact(st, lineOf(st)));
    } else if (ts.isExportDeclaration(st)) {
      handleExportDeclaration(st, facts, exportedLocals, lineOf(st));
    } else if (ts.isExportAssignment(st)) {
      facts.exports.push({ name: 'default', kind: 'variable', line: lineOf(st) });
      const fn = unwrapFunction(st.expression);
      if (ts.isIdentifier(st.expression)) exportedLocals.set(st.expression.text, 'default');
      else if (fn) facts.functions.push(functionMetrics(sf, 'default', fn, 'default'));
    } else if (ts.isFunctionDeclaration(st)) {
      const name = st.name?.text ?? 'default';
      const exportName = exported ? (isDefault ? 'default' : name) : undefined;
      if (exportName) facts.exports.push({ name: exportName, kind: 'function', line: lineOf(st) });
      if (st.body) facts.functions.push(functionMetrics(sf, name, st, exportName));
    } else if (ts.isClassDeclaration(st)) {
      if (exported) facts.exports.push({ name: isDefault ? 'default' : (st.name?.text ?? 'default'), kind: 'class', line: lineOf(st) });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const name = d.name.text;
        if (exported) facts.exports.push({ name, kind: 'variable', line: lineOf(d) });
        const fn = d.initializer ? unwrapFunction(d.initializer) : undefined;
        if (fn) facts.functions.push(functionMetrics(sf, name, fn, exported ? name : undefined));
      }
    } else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) {
      if (exported) facts.exports.push({ name: st.name.text, kind: 'type', line: lineOf(st) });
    }
  }

  for (const fn of facts.functions) {
    if (!fn.exportName && exportedLocals.has(fn.name)) fn.exportName = exportedLocals.get(fn.name);
  }
  return facts;
}
```

- [ ] **Step 4: Kör testet och se att det passerar**

Run: `pnpm vitest run packages/core/src/parse`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parse
git commit -m "feat(core): extract imports, exports, directives and functions per file"
```

---

### Task 3: Anrop och problem (fetch, tabeller, env, sväljda fel, hemliga nycklar)

**Files:**
- Create: `packages/core/src/parse/calls.ts`
- Modify: `packages/core/src/parse/extract.ts` (anropa `collectCallsAndProblems` före `return facts`)
- Test: `packages/core/src/parse/calls.test.ts`

**Interfaces:**
- Consumes: `extractFacts` (Task 2); typer `FileFacts`, `FunctionFact` (Task 1).
- Produces: `collectCallsAndProblems(sf: ts.SourceFile, facts: FileFacts): void`. Efter detta fyller `extractFacts` även `calls`, `problems` och dynamiska importer.

- [ ] **Step 1: Skriv det fallerande testet**

`packages/core/src/parse/calls.test.ts`:

```ts
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
```

- [ ] **Step 2: Kör testet och se att det fallerar**

Run: `pnpm vitest run packages/core/src/parse/calls.test.ts`
Expected: FAIL, `calls` is empty.

- [ ] **Step 3: Implementera**

`packages/core/src/parse/calls.ts`:

```ts
import ts from 'typescript';
import type { FileFacts, FunctionFact } from '../model/types';

const SUPABASE_READ = new Set(['select']);
const SUPABASE_WRITE = new Set(['insert', 'update', 'upsert', 'delete']);
const PRISMA_READ = new Set(['findMany', 'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
const PRISMA_WRITE = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
const SECRET_PATTERNS = [
  /^sk_(live|test)_[A-Za-z0-9]{10,}/,
  /^rk_live_[A-Za-z0-9]{10,}/,
  /^sk-[A-Za-z0-9_-]{20,}/,
  /^ghp_[A-Za-z0-9]{30,}/,
  /^AKIA[0-9A-Z]{16}$/,
  /^eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\./,
];

function urlText(arg: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isTemplateExpression(arg)) return arg.head.text + arg.templateSpans.map((s) => '*' + s.literal.text).join('');
  return undefined;
}

function supabaseOp(call: ts.CallExpression): 'read' | 'write' | undefined {
  let cur: ts.Node = call;
  while (
    ts.isPropertyAccessExpression(cur.parent) &&
    cur.parent.expression === cur &&
    ts.isCallExpression(cur.parent.parent)
  ) {
    const method = cur.parent.name.text;
    if (SUPABASE_READ.has(method)) return 'read';
    if (SUPABASE_WRITE.has(method)) return 'write';
    cur = cur.parent.parent;
  }
  return undefined;
}

function isConsoleCall(st: ts.Statement): boolean {
  return (
    ts.isExpressionStatement(st) &&
    ts.isCallExpression(st.expression) &&
    ts.isPropertyAccessExpression(st.expression.expression) &&
    ts.isIdentifier(st.expression.expression.expression) &&
    st.expression.expression.expression.text === 'console'
  );
}

function isEmptyReturn(st: ts.Statement): boolean {
  if (!ts.isReturnStatement(st)) return false;
  const e = st.expression;
  return !e || e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined');
}

function swallows(block: ts.Block): boolean {
  return block.statements.every((st) => isConsoleCall(st) || isEmptyReturn(st));
}

function enclosing(fns: FunctionFact[], line: number): string | undefined {
  let best: FunctionFact | undefined;
  for (const f of fns) {
    if (f.startLine <= line && line <= f.endLine && (!best || f.endLine - f.startLine < best.endLine - best.startLine)) best = f;
  }
  return best?.name;
}

export function collectCallsAndProblems(sf: ts.SourceFile, facts: FileFacts): void {
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const arg0 = node.arguments[0];
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        if (arg0 && ts.isStringLiteralLike(arg0)) {
          facts.imports.push({ specifier: arg0.text, bindings: [{ imported: '*', local: '*' }], typeOnly: false, line: lineOf(node) });
        }
      } else if (ts.isIdentifier(callee) && callee.text === 'fetch' && arg0) {
        const url = urlText(arg0);
        if (url?.startsWith('/')) facts.calls.push({ kind: 'fetch', value: url.split('?')[0], line: lineOf(node) });
      } else if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'from' && arg0 && ts.isStringLiteralLike(arg0)) {
        const op = supabaseOp(node);
        if (op) facts.calls.push({ kind: 'table', value: arg0.text, op, line: lineOf(node) });
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isPropertyAccessExpression(callee.expression) &&
        ts.isIdentifier(callee.expression.expression) &&
        /prisma|^db$/i.test(callee.expression.expression.text)
      ) {
        const method = callee.name.text;
        const op = PRISMA_READ.has(method) ? 'read' : PRISMA_WRITE.has(method) ? 'write' : undefined;
        if (op) facts.calls.push({ kind: 'table', value: callee.expression.name.text, op, line: lineOf(node) });
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'env' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'process'
    ) {
      facts.calls.push({ kind: 'env', value: node.name.text, line: lineOf(node) });
    }
    if (ts.isCatchClause(node) && swallows(node.block)) {
      facts.problems.push({ kind: 'swallowed-error', line: lineOf(node) });
    }
    if (ts.isStringLiteralLike(node) && SECRET_PATTERNS.some((r) => r.test(node.text))) {
      facts.problems.push({ kind: 'hardcoded-secret', line: lineOf(node), detail: node.text.slice(0, 6) + '…' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const c of facts.calls) {
    const fn = enclosing(facts.functions, c.line);
    if (fn) c.inFunction = fn;
  }
  for (const p of facts.problems) {
    const fn = enclosing(facts.functions, p.line);
    if (fn) p.inFunction = fn;
  }
}
```

I `packages/core/src/parse/extract.ts`, lägg till importen överst:

```ts
import { collectCallsAndProblems } from './calls';
```

och ersätt de sista raderna i `extractFacts`:

```ts
  for (const fn of facts.functions) {
    if (!fn.exportName && exportedLocals.has(fn.name)) fn.exportName = exportedLocals.get(fn.name);
  }
  return facts;
}
```

med:

```ts
  for (const fn of facts.functions) {
    if (!fn.exportName && exportedLocals.has(fn.name)) fn.exportName = exportedLocals.get(fn.name);
  }
  collectCallsAndProblems(sf, facts);
  return facts;
}
```

- [ ] **Step 4: Kör testerna och se att de passerar**

Run: `pnpm vitest run packages/core/src/parse`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parse
git commit -m "feat(core): detect fetch, table, env usage, swallowed errors and secrets"
```

---

### Task 4: Fixture `clean-app`, fillistning och modulupplösning

**Files:**
- Create: `fixtures/clean-app/**` (filer nedan)
- Create: `fixtures/conventions-app/package.json`, `fixtures/conventions-app/app/layout.tsx`, `fixtures/conventions-app/middleware.ts` (resten av fixturen i Task 8)
- Create: `packages/core/src/test-helpers.ts`, `packages/core/src/scan/files.ts`, `packages/core/src/resolve/resolver.ts`
- Test: `packages/core/src/scan/files.test.ts`, `packages/core/src/resolve/resolver.test.ts`

**Interfaces:**
- Consumes: inget från tidigare tasks.
- Produces: `fixture(name: string): string`; `listSourceFiles(root: string): string[]` (sorterade, relativa, `/`-separerade); `interface Resolver { resolve(specifier: string, fromFile: string): string | null }`; `createResolver(root: string): Resolver`; `loadCompilerOptions(root: string): ts.CompilerOptions`.

- [ ] **Step 1: Skapa fixturen `clean-app`**

`fixtures/clean-app/package.json`:

```json
{
  "name": "clean-app",
  "private": true,
  "dependencies": { "next": "15.0.0", "react": "19.0.0", "@supabase/supabase-js": "2.45.0" }
}
```

`fixtures/clean-app/tsconfig.json`:

```json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] }, "jsx": "preserve", "strict": true } }
```

`fixtures/clean-app/app/layout.tsx`:

```tsx
export const metadata = { title: 'Clean' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

`fixtures/clean-app/app/page.tsx`:

```tsx
import { ProfileCard } from '@/components/ProfileCard';
import { getProfile } from '@/lib/profiles';

export default async function Home() {
  const profile = await getProfile('1');
  return (
    <main>
      <ProfileCard name={profile.name} />
    </main>
  );
}
```

`fixtures/clean-app/app/api/profile/route.ts`:

```ts
import { getProfile } from '@/lib/profiles';

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const profile = await getProfile(id);
  return Response.json(profile);
}
```

`fixtures/clean-app/components/ProfileCard.tsx`:

```tsx
export function ProfileCard({ name }: { name: string }) {
  return <div className="card">{name}</div>;
}
```

`fixtures/clean-app/lib/profiles.ts`:

```ts
import { supabase } from '@/lib/supabase';

export async function getProfile(id: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
  if (error) throw error;
  return data as { name: string };
}
```

`fixtures/clean-app/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
```

- [ ] **Step 2: Skapa början av `conventions-app` (ingen tsconfig, avsiktligt)**

`fixtures/conventions-app/package.json`:

```json
{ "name": "conventions-app", "private": true, "dependencies": { "next": "15.0.0", "react": "19.0.0" } }
```

`fixtures/conventions-app/middleware.ts`:

```ts
export function middleware() {
  return undefined;
}

export const config = { matcher: ['/blog/:path*'] };
```

`fixtures/conventions-app/app/layout.tsx`:

```tsx
import { Nav } from './_components/Nav';

export const metadata = { title: 'Conventions' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Skriv de fallerande testerna**

`packages/core/src/test-helpers.ts`:

```ts
import { fileURLToPath } from 'node:url';

export function fixture(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
}
```

`packages/core/src/scan/files.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixture } from '../test-helpers';
import { listSourceFiles } from './files';

describe('listSourceFiles', () => {
  it('lists code files sorted with forward slashes', () => {
    expect(listSourceFiles(fixture('clean-app'))).toEqual([
      'app/api/profile/route.ts',
      'app/layout.tsx',
      'app/page.tsx',
      'components/ProfileCard.tsx',
      'lib/profiles.ts',
      'lib/supabase.ts',
    ]);
  });

  it('skips node_modules, declaration files and .gitignore entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-files-'));
    const write = (rel: string, text = 'export {};') => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    };
    write('a.ts');
    write('ignored/b.ts');
    write('node_modules/c/index.ts');
    write('types.d.ts');
    write('README.md', '# x');
    write('.gitignore', 'ignored/\n');
    expect(listSourceFiles(dir)).toEqual(['a.ts']);
  });
});
```

`packages/core/src/resolve/resolver.test.ts`:

```ts
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
```

- [ ] **Step 4: Kör testerna och se att de fallerar**

Run: `pnpm vitest run packages/core/src/scan packages/core/src/resolve`
Expected: FAIL, cannot resolve `./files` and `./resolver`.

- [ ] **Step 5: Implementera**

`packages/core/src/scan/files.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.mapskill', 'dist', 'build', 'out', 'coverage', '.vercel', '.turbo']);
const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;

export function listSourceFiles(root: string): string[] {
  const ig = ignore();
  const gitignore = path.join(root, '.gitignore');
  if (fs.existsSync(gitignore)) ig.add(fs.readFileSync(gitignore, 'utf8'));
  const out: string[] = [];
  const walk = (dirRel: string): void => {
    for (const entry of fs.readdirSync(path.join(root, dirRel), { withFileTypes: true })) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || ig.ignores(`${rel}/`)) continue;
        walk(rel);
      } else if (entry.isFile() && CODE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts') && !ig.ignores(rel)) {
        out.push(rel);
      }
    }
  };
  walk('');
  return out.sort();
}
```

`packages/core/src/resolve/resolver.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface Resolver {
  /** Returns a project-relative path with '/' separators, or null for packages and unresolvable imports. */
  resolve(specifier: string, fromFile: string): string | null;
}

function withDefaults(o: ts.CompilerOptions): ts.CompilerOptions {
  return {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    ...o,
    module: o.module ?? ts.ModuleKind.ESNext,
    moduleResolution: o.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
  };
}

export function loadCompilerOptions(root: string): ts.CompilerOptions {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error) break;
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, file);
    return withDefaults(parsed.options);
  }
  const target = fs.existsSync(path.join(root, 'src')) ? './src/*' : './*';
  return withDefaults({ baseUrl: root, paths: { '@/*': [target] } });
}

export function createResolver(root: string): Resolver {
  const options = loadCompilerOptions(root);
  const cache = ts.createModuleResolutionCache(root, (f) => f, options);
  return {
    resolve(specifier, fromFile) {
      const containing = path.join(root, fromFile);
      const resolved = ts.resolveModuleName(specifier, containing, options, ts.sys, cache).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) return null;
      const rel = path.relative(root, resolved.resolvedFileName).split(path.sep).join('/');
      if (rel.startsWith('..') || rel.includes('node_modules/') || rel.endsWith('.d.ts')) return null;
      return rel;
    },
  };
}
```

- [ ] **Step 6: Kör testerna och se att de passerar**

Run: `pnpm vitest run packages/core/src/scan packages/core/src/resolve`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add fixtures packages/core/src/test-helpers.ts packages/core/src/scan packages/core/src/resolve
git commit -m "feat(core): source file listing and tsconfig-aware module resolution"
```

---

### Task 5: Next.js-kunskap (rutter, tjänster, projektdetektion, Prisma)

**Files:**
- Create: `packages/core/src/adapters/file-kinds.ts`, `packages/core/src/adapters/nextjs/routes.ts`, `packages/core/src/adapters/nextjs/services.ts`, `packages/core/src/adapters/nextjs/project.ts`
- Test: `packages/core/src/adapters/nextjs/nextjs.test.ts`

**Interfaces:**
- Consumes: `fixture` (Task 4).
- Produces:
  - `isTestFile(p: string): boolean`, `isToolingConfig(p: string): boolean`
  - `type RouteKind = 'page' | 'layout' | 'route' | 'loading' | 'error' | 'not-found' | 'template' | 'default' | 'global-error' | 'pages-page' | 'pages-api' | 'middleware'`
  - `interface RouteFile { kind: RouteKind; route: string }`
  - `routeFileInfo(rel: string): RouteFile | null`, `routeMatches(route: string, url: string): boolean`
  - `interface Service { id: string; label: string; packages: string[] }`, `SERVICES: Service[]`, `serviceForSpecifier(spec: string): Service | null`
  - `isNextProject(root: string): boolean`, `readPrismaModels(root: string): string[]`

- [ ] **Step 1: Skriv det fallerande testet**

`packages/core/src/adapters/nextjs/nextjs.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixture } from '../../test-helpers';
import { isTestFile, isToolingConfig } from '../file-kinds';
import { isNextProject, readPrismaModels } from './project';
import { routeFileInfo, routeMatches } from './routes';
import { serviceForSpecifier } from './services';

describe('routeFileInfo', () => {
  it.each([
    ['app/page.tsx', { kind: 'page', route: '/' }],
    ['src/app/(marketing)/about/page.tsx', { kind: 'page', route: '/about' }],
    ['app/blog/[slug]/page.tsx', { kind: 'page', route: '/blog/[slug]' }],
    ['app/api/items/route.ts', { kind: 'route', route: '/api/items' }],
    ['app/@modal/login/page.tsx', { kind: 'page', route: '/login' }],
    ['app/dashboard/layout.tsx', { kind: 'layout', route: '/dashboard' }],
    ['app/not-found.tsx', { kind: 'not-found', route: '/' }],
    ['pages/index.tsx', { kind: 'pages-page', route: '/' }],
    ['pages/blog/index.tsx', { kind: 'pages-page', route: '/blog' }],
    ['pages/api/legacy.ts', { kind: 'pages-api', route: '/api/legacy' }],
    ['middleware.ts', { kind: 'middleware', route: '/' }],
  ])('%s', (file, expected) => {
    expect(routeFileInfo(file)).toEqual(expected);
  });

  it.each(['app/_components/Nav.tsx', 'app/_private/page.tsx', 'app/blog/utils.ts', 'lib/x.ts'])('%s is not a route file', (file) => {
    expect(routeFileInfo(file)).toBeNull();
  });
});

describe('routeMatches', () => {
  it('matches dynamic segments and fetch placeholders', () => {
    expect(routeMatches('/api/users/[id]', '/api/users/*')).toBe(true);
    expect(routeMatches('/api/users/[id]', '/api/users')).toBe(false);
    expect(routeMatches('/api/[...all]', '/api/a/b')).toBe(true);
    expect(routeMatches('/api/items', '/api/items')).toBe(true);
    expect(routeMatches('/', '/')).toBe(true);
  });
});

describe('services and file kinds', () => {
  it('maps package names to services', () => {
    expect(serviceForSpecifier('stripe')?.id).toBe('stripe');
    expect(serviceForSpecifier('@supabase/ssr/client')?.id).toBe('supabase');
    expect(serviceForSpecifier('react')).toBeNull();
  });

  it('classifies tests and tooling config', () => {
    expect(isTestFile('lib/date.test.ts')).toBe(true);
    expect(isTestFile('tests/e2e.ts')).toBe(true);
    expect(isTestFile('lib/date.ts')).toBe(false);
    expect(isToolingConfig('next.config.mjs')).toBe(true);
    expect(isToolingConfig('lib/site.config.ts')).toBe(false);
  });
});

describe('project detection', () => {
  it('detects Next.js projects', () => {
    expect(isNextProject(fixture('clean-app'))).toBe(true);
    expect(isNextProject(fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-empty-')))).toBe(false);
  });

  it('reads Prisma models as client accessor names', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-prisma-'));
    fs.mkdirSync(path.join(dir, 'prisma'));
    fs.writeFileSync(path.join(dir, 'prisma', 'schema.prisma'), 'model User {\n  id Int @id\n}\nmodel BlogPost {\n  id Int @id\n}\n');
    expect(readPrismaModels(dir)).toEqual(['user', 'blogPost']);
  });
});
```

- [ ] **Step 2: Kör testet och se att det fallerar**

Run: `pnpm vitest run packages/core/src/adapters`
Expected: FAIL, cannot resolve modules.

- [ ] **Step 3: Implementera**

`packages/core/src/adapters/file-kinds.ts`:

```ts
export function isTestFile(p: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || p.startsWith('tests/') || p.includes('/__tests__/');
}

export function isToolingConfig(p: string): boolean {
  return !p.includes('/') && /\.config\.[cm]?[jt]s$/.test(p);
}
```

`packages/core/src/adapters/nextjs/routes.ts`:

```ts
const APP_SPECIAL = ['page', 'layout', 'route', 'loading', 'error', 'not-found', 'template', 'default', 'global-error'] as const;

export type RouteKind = (typeof APP_SPECIAL)[number] | 'pages-page' | 'pages-api' | 'middleware';

export interface RouteFile {
  kind: RouteKind;
  route: string;
}

export function routeFileInfo(rel: string): RouteFile | null {
  const p = rel.startsWith('src/') ? rel.slice(4) : rel;
  if (/^middleware\.[cm]?[jt]sx?$/.test(p)) return { kind: 'middleware', route: '/' };

  const app = /^app\/(.*?)([^/]+)\.[cm]?[jt]sx?$/.exec(p);
  if (app) {
    const base = app[2] as (typeof APP_SPECIAL)[number];
    if (!APP_SPECIAL.includes(base)) return null;
    const dirs = app[1].split('/').filter(Boolean);
    if (dirs.some((d) => d.startsWith('_'))) return null;
    const segments = dirs.filter((d) => !(d.startsWith('(') && d.endsWith(')')) && !d.startsWith('@'));
    return { kind: base, route: '/' + segments.join('/') };
  }

  const pages = /^pages\/(.+)\.[cm]?[jt]sx?$/.exec(p);
  if (pages) {
    const rest = pages[1];
    if (rest.startsWith('api/') || rest === 'api') {
      return { kind: 'pages-api', route: '/' + rest.replace(/\/index$/, '') };
    }
    return { kind: 'pages-page', route: '/' + rest.replace(/(^|\/)index$/, '') };
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function routeMatches(route: string, url: string): boolean {
  const segments = route.split('/').filter(Boolean);
  const pattern = segments
    .map((s) => {
      if (s.startsWith('[[...')) return '(?:/.*)?';
      if (s.startsWith('[...')) return '/.+';
      if (s.startsWith('[')) return '/[^/]+';
      return '/' + escapeRegex(s);
    })
    .join('');
  return new RegExp('^' + (pattern || '/') + '/?$').test(url);
}
```

`packages/core/src/adapters/nextjs/services.ts`:

```ts
export interface Service {
  id: string;
  label: string;
  packages: string[];
}

export const SERVICES: Service[] = [
  { id: 'stripe', label: 'Stripe', packages: ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'] },
  { id: 'openai', label: 'OpenAI', packages: ['openai'] },
  { id: 'anthropic', label: 'Anthropic', packages: ['@anthropic-ai/sdk'] },
  { id: 'resend', label: 'Resend', packages: ['resend'] },
  { id: 'clerk', label: 'Clerk', packages: ['@clerk/nextjs'] },
  { id: 'authjs', label: 'Auth.js', packages: ['next-auth', '@auth/core'] },
  { id: 'supabase', label: 'Supabase', packages: ['@supabase/supabase-js', '@supabase/ssr', '@supabase/auth-helpers-nextjs'] },
  { id: 'firebase', label: 'Firebase', packages: ['firebase', 'firebase-admin'] },
  { id: 'vercel-ai', label: 'Vercel AI SDK', packages: ['ai', '@ai-sdk/openai', '@ai-sdk/anthropic'] },
  { id: 'uploadthing', label: 'UploadThing', packages: ['uploadthing', '@uploadthing/react'] },
  { id: 'sentry', label: 'Sentry', packages: ['@sentry/nextjs'] },
  { id: 'posthog', label: 'PostHog', packages: ['posthog-js', 'posthog-node'] },
];

export function serviceForSpecifier(spec: string): Service | null {
  const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return SERVICES.find((s) => s.packages.includes(pkg)) ?? null;
}
```

`packages/core/src/adapters/nextjs/project.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

export function isNextProject(root: string): boolean {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.next ?? pkg.devDependencies?.next);
  } catch {
    return false;
  }
}

export function readPrismaModels(root: string): string[] {
  const file = path.join(root, 'prisma', 'schema.prisma');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1].charAt(0).toLowerCase() + m[1].slice(1));
}
```

- [ ] **Step 4: Kör testet och se att det passerar**

Run: `pnpm vitest run packages/core/src/adapters`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/adapters
git commit -m "feat(core): Next.js routes, known services, project and Prisma detection"
```

---

### Task 6: Modell (noder, kanter) och `scanProject`

**Files:**
- Create: `packages/core/src/adapters/build-model.ts`, `packages/core/src/analyze/context.ts`, `packages/core/src/analyze/health.ts`, `packages/core/src/analyze/index.ts`, `packages/core/src/graph/scan.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/graph/scan.test.ts`

**Interfaces:**
- Consumes: `extractFacts` (Task 2-3); `listSourceFiles`, `createResolver` (Task 4); `routeFileInfo`, `routeMatches`, `serviceForSpecifier`, `isNextProject`, `readPrismaModels`, `isTestFile`, `isToolingConfig` (Task 5); `sha1` (Task 1).
- Produces:
  - `type ResolveFn = (specifier: string, fromFile: string) => string | null`
  - `interface Model { nodes: MapNode[]; edges: MapEdge[]; owner: (file: string, fn?: string) => string | undefined }`
  - `buildModel(input: { files: Record<string, FileFacts>; resolve: ResolveFn; prismaModels: string[]; framework: Framework }): Model`
  - `interface AnalysisContext { files: Record<string, FileFacts>; links: FileLink[]; nodes: MapNode[]; owner: (file: string, fn?: string) => string | undefined; framework: Framework }`
  - `makeFinding(kind: FindingKind, certainty: Certainty, files: string[], nodeIds: (string | undefined)[], message: Text, instruction: string, key?: string): Finding`
  - `runAnalyzers(ctx: AnalysisContext): Finding[]` (tom lista i denna task)
  - `computeHealth(nodes: MapNode[], findings: Finding[]): Record<string, number>`
  - `scanProject(root: string): Graph`
  - Nod-id: `page:<fil>`, `layout:<fil>`, `api-route:<fil>`, `config:<fil>`, `test:<fil>`, `file:<fil>`, `<component|helper|server-action>:<fil>#<funktion>`, `table:<namn>`, `service:<id>`.

- [ ] **Step 1: Skriv det fallerande testet**

`packages/core/src/graph/scan.test.ts`:

```ts
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
```

- [ ] **Step 2: Kör testet och se att det fallerar**

Run: `pnpm vitest run packages/core/src/graph`
Expected: FAIL, cannot resolve `./scan`.

- [ ] **Step 3: Implementera modellbyggaren**

`packages/core/src/adapters/build-model.ts`:

```ts
import path from 'node:path';
import type { EdgeKind, FileFacts, Framework, MapEdge, MapNode, NodeType, Zone } from '../model/types';
import { isTestFile, isToolingConfig } from './file-kinds';
import { routeFileInfo, routeMatches } from './nextjs/routes';
import { serviceForSpecifier } from './nextjs/services';

export type ResolveFn = (specifier: string, fromFile: string) => string | null;

export interface ModelInput {
  files: Record<string, FileFacts>;
  resolve: ResolveFn;
  prismaModels: string[];
  framework: Framework;
}

export interface Model {
  nodes: MapNode[];
  edges: MapEdge[];
  owner: (file: string, fn?: string) => string | undefined;
}

const ZONE: Record<NodeType, Zone> = {
  page: 'pages',
  layout: 'pages',
  'api-route': 'server',
  'server-action': 'server',
  config: 'server',
  component: 'blocks',
  helper: 'shared',
  file: 'shared',
  table: 'data',
  service: 'outside',
  test: 'tests',
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function buildModel(input: ModelInput): Model {
  const nodes: MapNode[] = [];
  const byId = new Map<string, MapNode>();
  const byFile = new Map<string, string[]>();
  const fnOwner = new Map<string, string>();

  const add = (n: Omit<MapNode, 'zone'>): string => {
    if (!byId.has(n.id)) {
      const full: MapNode = { ...n, zone: ZONE[n.type] };
      nodes.push(full);
      byId.set(n.id, full);
    }
    if (n.file) {
      const list = byFile.get(n.file) ?? [];
      if (!list.includes(n.id)) list.push(n.id);
      byFile.set(n.file, list);
    }
    return n.id;
  };

  for (const f of Object.values(input.files)) {
    const file = f.path;
    if (isToolingConfig(file)) continue;
    const base = path.posix.basename(file).replace(/\.[^.]+$/, '');
    const info = input.framework === 'nextjs' ? routeFileInfo(file) : null;
    let fileNode: string | undefined;
    if (isTestFile(file)) {
      fileNode = add({ id: `test:${file}`, type: 'test', label: base, file });
    } else if (info) {
      if (info.kind === 'page' || info.kind === 'pages-page') {
        fileNode = add({ id: `page:${file}`, type: 'page', label: info.route, route: info.route, file });
      } else if (info.kind === 'route' || info.kind === 'pages-api') {
        const methods = info.kind === 'pages-api' ? [] : f.exports.map((e) => e.name).filter((n) => HTTP_METHODS.includes(n));
        const label = `${methods.length ? methods.join(',') : 'ALL'} ${info.route}`;
        fileNode = add({ id: `api-route:${file}`, type: 'api-route', label, route: info.route, file });
      } else if (info.kind === 'middleware') {
        fileNode = add({ id: `config:${file}`, type: 'config', label: 'middleware', file });
      } else {
        fileNode = add({ id: `layout:${file}`, type: 'layout', label: `${info.kind} ${info.route}`, route: info.route, file });
      }
    }
    if (fileNode) {
      for (const fn of f.functions) fnOwner.set(`${file}#${fn.name}`, fileNode);
      continue;
    }
    const serverFile = f.directives.includes('use server');
    for (const fn of f.functions) {
      if (!fn.exportName) continue;
      const type: NodeType = serverFile ? 'server-action' : fn.returnsJsx ? 'component' : 'helper';
      const label = fn.name === 'default' ? base : fn.name;
      const id = add({ id: `${type}:${file}#${fn.name}`, type, label, file, startLine: fn.startLine, endLine: fn.endLine });
      fnOwner.set(`${file}#${fn.name}`, id);
    }
    if (!byFile.has(file)) add({ id: `file:${file}`, type: 'file', label: base, file });
  }

  for (const m of input.prismaModels) add({ id: `table:${m}`, type: 'table', label: m });
  for (const f of Object.values(input.files)) {
    for (const c of f.calls) if (c.kind === 'table') add({ id: `table:${c.value}`, type: 'table', label: c.value });
  }

  const owner = (file: string, fn?: string): string | undefined =>
    (fn ? fnOwner.get(`${file}#${fn}`) : undefined) ?? byFile.get(file)?.[0];

  const edges: MapEdge[] = [];
  const seen = new Set<string>();
  const link = (from: string | undefined, to: string | undefined, kind: EdgeKind): void => {
    if (!from || !to || from === to) return;
    const id = `${kind}:${from}->${to}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, from, to, kind });
  };
  const sourcesFor = (f: FileFacts, local: string): string[] => {
    const fromFunctions = f.functions
      .filter((fn) => fn.refs.includes(local))
      .map((fn) => owner(f.path, fn.name))
      .filter((x): x is string => Boolean(x));
    if (fromFunctions.length) return [...new Set(fromFunctions)];
    const primary = owner(f.path);
    return primary ? [primary] : [];
  };
  const exportNode = (target: string, name: string): string | undefined => {
    const fn = input.files[target]?.functions.find((x) => x.exportName === name);
    return owner(target, fn?.name);
  };

  for (const f of Object.values(input.files)) {
    if (!byFile.has(f.path)) continue;
    const testFile = isTestFile(f.path);
    for (const imp of f.imports) {
      if (imp.typeOnly) continue;
      const target = input.resolve(imp.specifier, f.path);
      const service = target ? null : serviceForSpecifier(imp.specifier);
      if (service) add({ id: `service:${service.id}`, type: 'service', label: service.label });
      for (const b of imp.bindings) {
        let targets: string[] = [];
        if (target && byFile.has(target)) {
          targets = b.imported === '*' ? (byFile.get(target) ?? []) : [exportNode(target, b.imported)].filter((x): x is string => Boolean(x));
        } else if (service) {
          targets = [`service:${service.id}`];
        }
        const primary = owner(f.path);
        const sources = b.local === '*' ? (primary ? [primary] : []) : sourcesFor(f, b.local);
        const kind: EdgeKind = testFile ? 'tests' : service ? 'talks-to' : 'uses';
        for (const s of sources) for (const t of targets) link(s, t, kind);
      }
    }
    for (const c of f.calls) {
      const src = owner(f.path, c.inFunction);
      if (c.kind === 'table') link(src, `table:${c.value}`, c.op === 'write' ? 'writes' : 'reads');
      if (c.kind === 'fetch') {
        for (const n of nodes) if (n.type === 'api-route' && n.route && routeMatches(n.route, c.value)) link(src, n.id, 'calls-api');
      }
    }
  }

  return { nodes, edges, owner };
}
```

- [ ] **Step 4: Implementera analyskontext, hälsa och skanning**

`packages/core/src/analyze/context.ts`:

```ts
import type { Certainty, FileFacts, FileLink, Finding, FindingKind, Framework, MapNode, Text } from '../model/types';
import { sha1 } from '../util/hash';

export interface AnalysisContext {
  files: Record<string, FileFacts>;
  links: FileLink[];
  nodes: MapNode[];
  owner: (file: string, fn?: string) => string | undefined;
  framework: Framework;
}

export function makeFinding(
  kind: FindingKind,
  certainty: Certainty,
  files: string[],
  nodeIds: (string | undefined)[],
  message: Text,
  instruction: string,
  key = '',
): Finding {
  const ids = [...new Set(nodeIds.filter((x): x is string => Boolean(x)))];
  const sortedFiles = [...new Set(files)].sort();
  const id = `${kind}:${sha1([...sortedFiles, ...ids, key].join('|')).slice(0, 12)}`;
  return { id, kind, certainty, nodeIds: ids, files: sortedFiles, message, instruction };
}
```

`packages/core/src/analyze/health.ts`:

```ts
import type { Finding, MapNode } from '../model/types';

export function computeHealth(nodes: MapNode[], findings: Finding[]): Record<string, number> {
  const score: Record<string, number> = {};
  for (const n of nodes) score[n.id] = 10;
  for (const f of findings) {
    for (const id of f.nodeIds) {
      if (id in score) score[id] = Math.max(1, score[id] - (f.certainty === 'certain' ? 2 : 1));
    }
  }
  return score;
}
```

`packages/core/src/analyze/index.ts`:

```ts
import type { Finding } from '../model/types';
import type { AnalysisContext } from './context';

export function runAnalyzers(ctx: AnalysisContext): Finding[] {
  void ctx;
  return [];
}
```

`packages/core/src/graph/scan.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { buildModel } from '../adapters/build-model';
import { isNextProject, readPrismaModels } from '../adapters/nextjs/project';
import { computeHealth } from '../analyze/health';
import { runAnalyzers } from '../analyze/index';
import type { FileFacts, FileLink, Framework, Graph } from '../model/types';
import { extractFacts } from '../parse/extract';
import { createResolver } from '../resolve/resolver';
import { listSourceFiles } from '../scan/files';

export function scanProject(root: string): Graph {
  const framework: Framework = isNextProject(root) ? 'nextjs' : 'generic';
  const files: Record<string, FileFacts> = {};
  for (const rel of listSourceFiles(root)) {
    const abs = path.join(root, rel);
    files[rel] = extractFacts(rel, fs.readFileSync(abs, 'utf8'), fs.statSync(abs).mtimeMs);
  }

  const resolver = createResolver(root);
  const cache = new Map<string, string | null>();
  const resolve = (specifier: string, from: string): string | null => {
    const key = `${from}\u0000${specifier}`;
    if (!cache.has(key)) cache.set(key, resolver.resolve(specifier, from));
    return cache.get(key) ?? null;
  };

  const links: FileLink[] = [];
  for (const f of Object.values(files)) {
    for (const imp of f.imports) {
      const to = resolve(imp.specifier, f.path);
      if (to && files[to]) links.push({ from: f.path, to, names: imp.bindings.map((b) => b.imported), typeOnly: imp.typeOnly });
    }
  }

  const model = buildModel({ files, resolve, prismaModels: readPrismaModels(root), framework });
  const findings = runAnalyzers({ files, links, nodes: model.nodes, owner: model.owner, framework });
  return {
    root,
    framework,
    files,
    links,
    nodes: model.nodes,
    edges: model.edges,
    findings,
    health: computeHealth(model.nodes, findings),
  };
}
```

`packages/core/src/index.ts`:

```ts
export * from './model/types';
export { scanProject } from './graph/scan';
export { extractFacts } from './parse/extract';
export { routeFileInfo, routeMatches } from './adapters/nextjs/routes';
```

- [ ] **Step 5: Kör testet och se att det passerar**

Run: `pnpm vitest run packages/core/src/graph`
Expected: PASS, 4 tests.

- [ ] **Step 6: Kör hela sviten och typkontrollen**

Run: `pnpm test && pnpm typecheck`
Expected: alla tester PASS, `tsc` utan fel.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): build beginner-level nodes and edges, scanProject entry point"
```

---

### Task 7: Klarspråk och dubblettanalys (fixture `messy-app`)

**Files:**
- Create: `fixtures/messy-app/**` (filer nedan)
- Create: `packages/core/src/text/messages.ts`, `packages/core/src/text/labels.ts`, `packages/core/src/analyze/duplicates.ts`
- Modify: `packages/core/src/analyze/index.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/analyze/duplicates.test.ts`

**Interfaces:**
- Consumes: `AnalysisContext`, `makeFinding` (Task 6); `scanProject` (Task 6); `fixture` (Task 4).
- Produces: `msg` (objekt med en funktion per fyndtyp, alla returnerar `Text`); `ZONE_LABELS: Record<Zone, Text>`; `findDuplicates(ctx: AnalysisContext): Finding[]`.

- [ ] **Step 1: Skapa fixturen `messy-app`**

`fixtures/messy-app/package.json`:

```json
{
  "name": "messy-app",
  "private": true,
  "dependencies": { "next": "15.0.0", "react": "19.0.0", "stripe": "17.0.0", "@supabase/supabase-js": "2.45.0" }
}
```

`fixtures/messy-app/tsconfig.json`:

```json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] }, "jsx": "preserve", "strict": true } }
```

`fixtures/messy-app/app/layout.tsx`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

`fixtures/messy-app/app/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { formatDate } from '@/lib/date';
import { formatDay } from '@/lib/date-utils';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [rows, setRows] = useState<{ id: string; created: string }[]>([]);
  useEffect(() => {
    supabase.from('orders').select('*').then(({ data }) => setRows(data ?? []));
  }, []);
  const secret = process.env.STRIPE_SECRET_KEY;
  return (
    <ul data-k={secret ? 'y' : 'n'}>
      {rows.map((r) => (
        <li key={r.id}>
          {formatDate(r.created)} {formatDay(r.created)}
        </li>
      ))}
    </ul>
  );
}
```

`fixtures/messy-app/app/api/checkout/route.ts`:

```ts
import Stripe from 'stripe';
import { discountFor } from '@/lib/discount';
import { notify } from '@/lib/notify';
import { a } from '@/lib/cycle-a';

const stripe = new Stripe('sk_live_51HxAbCdEfGhIjKlMnOpQr');

export async function POST(request: Request) {
  const body = await request.json();
  const rate = discountFor(body.user, body.total);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: body.items,
    metadata: { rate: String(rate), depth: String(a(3)) },
  });
  await notify('https://example.com/hook');
  return Response.json({ url: session.url });
}
```

`fixtures/messy-app/lib/date.ts`:

```ts
export function formatDate(input: string): string {
  const date = new Date(input);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateCopy(input: string): string {
  const date = new Date(input);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

`fixtures/messy-app/lib/date-utils.ts`:

```ts
export function formatDay(value: string): string {
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
```

`fixtures/messy-app/lib/cart.ts`:

```ts
export function cartTotal(items: { price: number; qty: number }[]): number {
  let total = 0;
  for (const item of items) {
    const line = item.price * item.qty;
    total += line;
  }
  const tax = total * 0.25;
  const shipping = total > 500 ? 0 : 49;
  const sum = total + tax + shipping;
  const rounded = Math.round(sum * 100) / 100;
  const fee = rounded > 0 ? 5 : 0;
  const final = rounded + fee;
  return final;
}

export function orderTotal(items: { price: number; qty: number }[]): number {
  let total = 0;
  for (const item of items) {
    const line = item.price * item.qty;
    total += line;
  }
  const tax = total * 0.25;
  const shipping = total >= 500 ? 0 : 49;
  const sum = total + tax + shipping;
  const rounded = Math.round(sum * 100) / 100;
  const fee = rounded > 0 ? 5 : 0;
  const final = rounded + fee;
  return final;
}
```

`fixtures/messy-app/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
```

`fixtures/messy-app/lib/notify.ts`:

```ts
export async function notify(url: string) {
  try {
    await fetch(url, { method: 'POST' });
  } catch (e) {}
}
```

`fixtures/messy-app/lib/discount.ts`:

```ts
export function discountFor(user: { vip: boolean; orders: number; country: string }, total: number): number {
  let discount = 0;
  if (user.vip) {
    if (total > 1000) {
      if (user.country === 'SE' || user.country === 'NO') {
        discount = 0.2;
      } else {
        discount = 0.15;
      }
    } else if (total > 500) {
      discount = 0.1;
    }
  } else {
    for (let i = 0; i < user.orders; i++) {
      if (i > 10 && total > 200) {
        discount += 0.01;
        if (discount > 0.1) {
          break;
        }
      }
    }
  }
  return discount;
}
```

`fixtures/messy-app/lib/cycle-a.ts`:

```ts
import { b } from './cycle-b';

export function a(n: number): number {
  return n <= 0 ? 0 : b(n - 1);
}
```

`fixtures/messy-app/lib/cycle-b.ts`:

```ts
import { a } from './cycle-a';

export function b(n: number): number {
  return n <= 0 ? 0 : a(n - 1);
}
```

`fixtures/messy-app/components/OldBanner.tsx`:

```tsx
export function OldBanner() {
  return <div>Old</div>;
}
```

- [ ] **Step 2: Skriv det fallerande testet**

`packages/core/src/analyze/duplicates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scanProject } from '../graph/scan';
import { fixture } from '../test-helpers';

describe('findDuplicates', () => {
  const messy = scanProject(fixture('messy-app'));
  const of = (kind: string) => messy.findings.filter((f) => f.kind === kind);

  it('finds exact duplicates', () => {
    const [f] = of('exact-duplicate');
    expect(f.certainty).toBe('certain');
    expect(f.nodeIds).toEqual(expect.arrayContaining(['helper:lib/date.ts#formatDate', 'helper:lib/date.ts#formatDateCopy']));
    expect(f.message.sv).toContain('formatDate');
  });

  it('finds renamed duplicates across files', () => {
    const [f] = of('renamed-duplicate');
    expect(f.certainty).toBe('certain');
    expect(f.nodeIds).toContain('helper:lib/date-utils.ts#formatDay');
    expect(f.files).toEqual(['lib/date-utils.ts', 'lib/date.ts']);
  });

  it('finds near duplicates as likely', () => {
    const [f] = of('near-duplicate');
    expect(f.certainty).toBe('likely');
    expect(f.nodeIds.sort()).toEqual(['helper:lib/cart.ts#cartTotal', 'helper:lib/cart.ts#orderTotal']);
  });

  it('reports nothing in clean-app', () => {
    const clean = scanProject(fixture('clean-app'));
    expect(clean.findings.filter((f) => f.kind.endsWith('duplicate'))).toEqual([]);
  });
});
```

- [ ] **Step 3: Kör testet och se att det fallerar**

Run: `pnpm vitest run packages/core/src/analyze/duplicates.test.ts`
Expected: FAIL, `of('exact-duplicate')` is empty so `f` is undefined.

- [ ] **Step 4: Implementera klarspråk**

`packages/core/src/text/messages.ts`:

```ts
import type { Text } from '../model/types';

export const msg = {
  exactDuplicate: (names: string): Text => ({
    en: `These do exactly the same thing: ${names}. Are all of them needed?`,
    sv: `Dessa gör exakt samma sak: ${names}. Behövs alla?`,
  }),
  renamedDuplicate: (names: string): Text => ({
    en: `Same code with different names: ${names}. Merge them?`,
    sv: `Samma kod med olika namn: ${names}. Slå ihop?`,
  }),
  nearDuplicate: (names: string, percent: number): Text => ({
    en: `These are ${percent}% alike: ${names}. Could they be one?`,
    sv: `Dessa är ${percent} % lika: ${names}. Kan de bli en?`,
  }),
  unusedExport: (name: string): Text => ({
    en: `No other file uses ${name}. Should it go?`,
    sv: `Ingen annan fil använder ${name}. Ska den bort?`,
  }),
  orphanFile: (file: string): Text => ({
    en: `${file} is not used anywhere.`,
    sv: `${file} används inte någonstans.`,
  }),
  complexFunction: (name: string, score: number): Text => ({
    en: `${name} is hard to follow (complexity ${score}). Split it up?`,
    sv: `${name} är svår att följa (komplexitet ${score}). Dela upp?`,
  }),
  longFile: (file: string, lines: number): Text => ({
    en: `${file} has ${lines} lines and does many things.`,
    sv: `${file} har ${lines} rader och gör många saker.`,
  }),
  clientTouchesServer: (file: string, what: string): Text => ({
    en: `${file} runs in the browser but uses ${what}, which belongs on the server.`,
    sv: `${file} körs i webbläsaren men använder ${what}, som hör hemma på servern.`,
  }),
  pageTouchesTable: (file: string, tables: string): Text => ({
    en: `${file} talks directly to the database (${tables}) from the browser. Usually this goes through a server function.`,
    sv: `${file} pratar direkt med databasen (${tables}) från webbläsaren. Vanligtvis går det via en serverfunktion.`,
  }),
  circularImport: (files: string[]): Text => ({
    en: `These files use each other in a circle: ${files.join(', ')}.`,
    sv: `Dessa filer använder varandra i en cirkel: ${files.join(', ')}.`,
  }),
  hardcodedSecret: (file: string, preview: string): Text => ({
    en: `This looks like a secret key written directly in ${file} (${preview}).`,
    sv: `Det här ser ut som en hemlig nyckel direkt i ${file} (${preview}).`,
  }),
  swallowedError: (file: string, line: number): Text => ({
    en: `Errors are silenced in ${file}:${line}. Nobody will notice if something breaks.`,
    sv: `Fel tystas i ${file}:${line}. Ingen märker om något går sönder.`,
  }),
};
```

`packages/core/src/text/labels.ts`:

```ts
import type { Text, Zone } from '../model/types';

export const ZONE_LABELS: Record<Zone, Text> = {
  pages: { en: 'Pages', sv: 'Sidor' },
  blocks: { en: 'Building blocks', sv: 'Byggstenar' },
  server: { en: 'Server', sv: 'Server' },
  data: { en: 'Data', sv: 'Data' },
  shared: { en: 'Shared', sv: 'Delat' },
  outside: { en: 'Outside', sv: 'Utanför' },
  tests: { en: 'Tests', sv: 'Tester' },
};
```

- [ ] **Step 5: Implementera dubblettanalysen och koppla in den**

`packages/core/src/analyze/duplicates.ts`:

```ts
import type { Certainty, Finding, FindingKind, FunctionFact } from '../model/types';
import { msg } from '../text/messages';
import { makeFinding, type AnalysisContext } from './context';

interface Item {
  file: string;
  mtime: number;
  fn: FunctionFact;
}

const MIN_STATEMENTS = 5;
const MIN_NEAR_STATEMENTS = 8;
const NEAR_THRESHOLD = 0.8;

export function findDuplicates(ctx: AnalysisContext): Finding[] {
  const items: Item[] = Object.values(ctx.files).flatMap((f) => f.functions.map((fn) => ({ file: f.path, mtime: f.mtimeMs, fn })));
  const key = (x: Item): string => `${x.file}#${x.fn.name}#${x.fn.startLine}`;
  const claimed = new Set<string>();
  const out: Finding[] = [];

  const passes: [FindingKind, (x: Item) => string][] = [
    ['exact-duplicate', (x) => x.fn.exactHash],
    ['renamed-duplicate', (x) => x.fn.renamedHash],
  ];
  for (const [kind, hashOf] of passes) {
    const groups = new Map<string, Item[]>();
    for (const x of items) {
      if (x.fn.statements < MIN_STATEMENTS) continue;
      const g = groups.get(hashOf(x)) ?? [];
      g.push(x);
      groups.set(hashOf(x), g);
    }
    for (const g of groups.values()) {
      if (g.length < 2 || g.every((x) => claimed.has(key(x)))) continue;
      for (const x of g) claimed.add(key(x));
      out.push(duplicateFinding(kind, 'certain', g, ctx));
    }
  }

  const big = items.filter((x) => x.fn.statements >= MIN_NEAR_STATEMENTS && !claimed.has(key(x)));
  const sets = big.map((x) => new Set(x.fn.shingles));
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (Math.min(a.size, b.size) / Math.max(a.size, b.size) < NEAR_THRESHOLD) continue;
      let inter = 0;
      for (const s of a) if (b.has(s)) inter++;
      const similarity = inter / (a.size + b.size - inter);
      if (similarity >= NEAR_THRESHOLD) out.push(duplicateFinding('near-duplicate', 'likely', [big[i], big[j]], ctx, similarity));
    }
  }
  return out;
}

function duplicateFinding(kind: FindingKind, certainty: Certainty, group: Item[], ctx: AnalysisContext, similarity = 1): Finding {
  const sorted = [...group].sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file) || a.fn.startLine - b.fn.startLine);
  const keep = sorted[0];
  const where = (x: Item): string => `${x.fn.name} (${x.file}:${x.fn.startLine})`;
  const names = sorted.map((x) => x.fn.name).join(', ');
  const message =
    kind === 'exact-duplicate'
      ? msg.exactDuplicate(names)
      : kind === 'renamed-duplicate'
        ? msg.renamedDuplicate(names)
        : msg.nearDuplicate(names, Math.round(similarity * 100));
  const instruction =
    `${sorted.map(where).join(', ')} are ${kind.replace('-', ' ')}s. ` +
    `Keep ${where(keep)}, make the others use it, and delete the copies. ` +
    `If they must stay separate, tell the user why.`;
  return makeFinding(
    kind,
    certainty,
    sorted.map((x) => x.file),
    sorted.map((x) => ctx.owner(x.file, x.fn.name)),
    message,
    instruction,
  );
}
```

Ersätt hela `packages/core/src/analyze/index.ts` med:

```ts
import type { Finding } from '../model/types';
import type { AnalysisContext } from './context';
import { findDuplicates } from './duplicates';

export function runAnalyzers(ctx: AnalysisContext): Finding[] {
  return [...findDuplicates(ctx)];
}
```

Lägg till i slutet av `packages/core/src/index.ts`:

```ts
export { msg } from './text/messages';
export { ZONE_LABELS } from './text/labels';
```

- [ ] **Step 6: Kör testet och se att det passerar**

Run: `pnpm vitest run packages/core/src/analyze`
Expected: PASS, 4 tests.

Om `near-duplicate` saknas: skriv ut likheten med `console.log` i testet för att se värdet. Fixturens två funktioner skiljer sig med en token (`>` mot `>=`) av cirka 100, så likheten ska ligga runt 0,9. Ändra inte tröskeln; ändra fixturen om den ligger under.

- [ ] **Step 7: Commit**

```bash
git add fixtures/messy-app packages/core/src
git commit -m "feat(core): plain-language messages and exact, renamed and near duplicate detection"
```

---

### Task 8: Oanvända exporter och föräldralösa filer (fixture `conventions-app`)

**Files:**
- Create: resten av `fixtures/conventions-app/**` (filer nedan)
- Create: `packages/core/src/analyze/unused.ts`
- Modify: `packages/core/src/analyze/index.ts`
- Test: `packages/core/src/analyze/unused.test.ts`

**Interfaces:**
- Consumes: `AnalysisContext`, `makeFinding` (Task 6); `msg` (Task 7); `routeFileInfo` (Task 5); `isTestFile`, `isToolingConfig` (Task 5).
- Produces: `findUnused(ctx: AnalysisContext): Finding[]`; `isEntryFile(file: string, framework: Framework): boolean`.

- [ ] **Step 1: Komplettera `conventions-app`**

`fixtures/conventions-app/app/_components/Nav.tsx`:

```tsx
export function Nav() {
  return <nav />;
}
```

`fixtures/conventions-app/app/(marketing)/about/page.tsx`:

```tsx
export const dynamic = 'force-static';

export default function About() {
  return <p>About</p>;
}
```

`fixtures/conventions-app/app/blog/[slug]/page.tsx`:

```tsx
export async function generateStaticParams() {
  return [{ slug: 'a' }];
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  return { title: params.slug };
}

export default function Post({ params }: { params: { slug: string } }) {
  return <h1>{params.slug}</h1>;
}
```

`fixtures/conventions-app/app/api/items/route.ts`:

```ts
export const runtime = 'edge';

export async function GET() {
  return Response.json([]);
}

export async function POST() {
  return Response.json({ ok: true });
}
```

`fixtures/conventions-app/app/not-found.tsx`:

```tsx
export default function NotFound() {
  return <p>Not found</p>;
}
```

`fixtures/conventions-app/app/loading.tsx`:

```tsx
export default function Loading() {
  return <p>Loading</p>;
}
```

`fixtures/conventions-app/pages/api/legacy.ts`:

```ts
export default function handler(req: unknown, res: { json: (v: unknown) => void }) {
  res.json({ ok: true });
}
```

- [ ] **Step 2: Skriv det fallerande testet**

`packages/core/src/analyze/unused.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scanProject } from '../graph/scan';
import { fixture } from '../test-helpers';
import { isEntryFile } from './unused';

describe('findUnused', () => {
  it('flags unused exports and orphan files in messy-app', () => {
    const g = scanProject(fixture('messy-app'));
    const unused = g.findings.filter((f) => f.kind === 'unused-export');
    const orphans = g.findings.filter((f) => f.kind === 'orphan-file').map((f) => f.files[0]);
    expect(unused.some((f) => f.nodeIds.includes('helper:lib/date.ts#formatDateCopy'))).toBe(true);
    expect(unused.some((f) => f.nodeIds.includes('component:components/OldBanner.tsx#OldBanner'))).toBe(true);
    expect(unused.some((f) => f.nodeIds.includes('helper:lib/date.ts#formatDate'))).toBe(false);
    expect(orphans).toContain('components/OldBanner.tsx');
    expect(orphans).not.toContain('lib/date.ts');
  });

  it.each(['clean-app', 'conventions-app'])('reports nothing in %s', (name) => {
    const g = scanProject(fixture(name));
    expect(g.findings.filter((f) => f.kind === 'unused-export' || f.kind === 'orphan-file')).toEqual([]);
  });

  it('maps conventions-app routes', () => {
    const g = scanProject(fixture('conventions-app'));
    const labels = g.nodes.filter((n) => n.type === 'page' || n.type === 'api-route').map((n) => n.label).sort();
    expect(labels).toEqual(['/about', '/blog/[slug]', 'ALL /api/legacy', 'GET,POST /api/items']);
  });

  it('treats route files, root files and tests as entry points', () => {
    expect(isEntryFile('app/page.tsx', 'nextjs')).toBe(true);
    expect(isEntryFile('next.config.mjs', 'nextjs')).toBe(true);
    expect(isEntryFile('lib/x.test.ts', 'nextjs')).toBe(true);
    expect(isEntryFile('lib/x.ts', 'nextjs')).toBe(false);
    expect(isEntryFile('src/index.ts', 'generic')).toBe(true);
  });
});
```

- [ ] **Step 3: Kör testet och se att det fallerar**

Run: `pnpm vitest run packages/core/src/analyze/unused.test.ts`
Expected: FAIL, cannot resolve `./unused`.

- [ ] **Step 4: Implementera och koppla in**

`packages/core/src/analyze/unused.ts`:

```ts
import { isTestFile, isToolingConfig } from '../adapters/file-kinds';
import { routeFileInfo } from '../adapters/nextjs/routes';
import type { Finding, Framework } from '../model/types';
import { msg } from '../text/messages';
import { makeFinding, type AnalysisContext } from './context';

const FRAMEWORK_EXPORTS = new Set([
  'default', 'metadata', 'generateMetadata', 'generateStaticParams', 'generateViewport', 'viewport',
  'revalidate', 'dynamic', 'dynamicParams', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  'config', 'middleware', 'getServerSideProps', 'getStaticProps', 'getStaticPaths',
]);

export function isEntryFile(file: string, framework: Framework): boolean {
  if (isTestFile(file) || !file.includes('/') || file.startsWith('scripts/') || file.startsWith('prisma/')) return true;
  if (framework === 'nextjs') return routeFileInfo(file) !== null || /^(src\/)?instrumentation\.[cm]?[jt]sx?$/.test(file);
  return /^(src\/)?(index|main|app|server)\.[cm]?[jt]sx?$/.test(file);
}

export function findUnused(ctx: AnalysisContext): Finding[] {
  const out: Finding[] = [];
  const usedNames = new Map<string, Set<string>>();
  for (const l of ctx.links) {
    const s = usedNames.get(l.to) ?? new Set<string>();
    for (const n of l.names) s.add(n);
    usedNames.set(l.to, s);
  }

  for (const f of Object.values(ctx.files)) {
    if (isTestFile(f.path) || isToolingConfig(f.path)) continue;
    const routeFile = ctx.framework === 'nextjs' && routeFileInfo(f.path) !== null;
    const used = usedNames.get(f.path) ?? new Set<string>();
    if (used.has('*')) continue;
    for (const e of f.exports) {
      if (e.kind === 'type' || e.kind === 'reexport' || e.name === '*') continue;
      if (routeFile && FRAMEWORK_EXPORTS.has(e.name)) continue;
      if (used.has(e.name)) continue;
      if (f.functions.some((fn) => fn.refs.includes(e.name))) continue;
      const fn = f.functions.find((x) => x.exportName === e.name);
      out.push(
        makeFinding(
          'unused-export',
          'certain',
          [f.path],
          [ctx.owner(f.path, fn?.name)],
          msg.unusedExport(e.name),
          `No file imports "${e.name}" from ${f.path}. If it is really unused, delete it. If something should use it, wire it up instead.`,
          e.name,
        ),
      );
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const l of ctx.links) adjacency.set(l.from, [...(adjacency.get(l.from) ?? []), l.to]);
  const reached = new Set<string>();
  const queue = Object.keys(ctx.files).filter((p) => isEntryFile(p, ctx.framework));
  while (queue.length) {
    const p = queue.pop()!;
    if (reached.has(p)) continue;
    reached.add(p);
    for (const next of adjacency.get(p) ?? []) if (!reached.has(next)) queue.push(next);
  }
  for (const p of Object.keys(ctx.files)) {
    if (reached.has(p)) continue;
    out.push(
      makeFinding(
        'orphan-file',
        'certain',
        [p],
        [ctx.owner(p)],
        msg.orphanFile(p),
        `${p} is not imported by any page, route or other used file. Delete it if it is leftover, or import it where it was meant to be used.`,
      ),
    );
  }
  return out;
}
```

Ersätt hela `packages/core/src/analyze/index.ts` med:

```ts
import type { Finding } from '../model/types';
import type { AnalysisContext } from './context';
import { findDuplicates } from './duplicates';
import { findUnused } from './unused';

export function runAnalyzers(ctx: AnalysisContext): Finding[] {
  return [...findDuplicates(ctx), ...findUnused(ctx)];
}
```

- [ ] **Step 5: Kör testerna och se att de passerar**

Run: `pnpm vitest run packages/core/src`
Expected: PASS, alla tester inklusive Task 6 (clean-app ger fortfarande hälsa 10 på alla noder eftersom den saknar fynd).

- [ ] **Step 6: Commit**

```bash
git add fixtures/conventions-app packages/core/src/analyze
git commit -m "feat(core): unused exports and orphan files with Next.js convention awareness"
```

---

### Task 9: Strukturregler, komplexitet och hälsa

**Files:**
- Create: `packages/core/src/analyze/cycles.ts`, `packages/core/src/analyze/rules.ts`
- Modify: `packages/core/src/analyze/index.ts`
- Test: `packages/core/src/analyze/rules.test.ts`

**Interfaces:**
- Consumes: `AnalysisContext`, `makeFinding`, `computeHealth` (Task 6); `msg` (Task 7); typ `FileLink` (Task 1).
- Produces: `findCycles(links: FileLink[]): string[][]`; `findRuleBreaks(ctx: AnalysisContext): Finding[]`.

- [ ] **Step 1: Skriv det fallerande testet**

`packages/core/src/analyze/rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scanProject } from '../graph/scan';
import { fixture } from '../test-helpers';
import { findCycles } from './cycles';

describe('findCycles', () => {
  it('returns strongly connected groups, ignoring type-only links', () => {
    expect(
      findCycles([
        { from: 'a', to: 'b', names: [], typeOnly: false },
        { from: 'b', to: 'a', names: [], typeOnly: false },
        { from: 'b', to: 'c', names: [], typeOnly: false },
        { from: 'c', to: 'd', names: [], typeOnly: true },
        { from: 'd', to: 'c', names: [], typeOnly: false },
      ]),
    ).toEqual([['a', 'b']]);
  });
});

describe('findRuleBreaks on messy-app', () => {
  const g = scanProject(fixture('messy-app'));
  const find = (kind: string) => g.findings.filter((f) => f.kind === kind);

  it('flags browser code that touches server secrets', () => {
    const [f] = find('client-touches-server');
    expect(f.certainty).toBe('certain');
    expect(f.files).toEqual(['app/page.tsx']);
    expect(f.message.en).toContain('STRIPE_SECRET_KEY');
  });

  it('flags direct table access from the browser as likely', () => {
    const [f] = find('page-touches-table');
    expect(f.certainty).toBe('likely');
    expect(f.message.en).toContain('orders');
  });

  it('flags the import cycle, the secret, the swallowed error and the complex function', () => {
    expect(find('circular-import')[0].files).toEqual(['lib/cycle-a.ts', 'lib/cycle-b.ts']);
    expect(find('hardcoded-secret')[0]).toMatchObject({ certainty: 'certain', files: ['app/api/checkout/route.ts'] });
    expect(find('swallowed-error')[0]).toMatchObject({ certainty: 'likely', nodeIds: ['helper:lib/notify.ts#notify'] });
    expect(find('complex-function')[0]).toMatchObject({ certainty: 'likely', nodeIds: ['helper:lib/discount.ts#discountFor'] });
  });

  it('lowers health for nodes with findings', () => {
    expect(g.health['helper:lib/date-utils.ts#formatDay']).toBeLessThan(10);
    expect(g.health['helper:lib/discount.ts#discountFor']).toBe(9);
  });
});
```

- [ ] **Step 2: Kör testet och se att det fallerar**

Run: `pnpm vitest run packages/core/src/analyze/rules.test.ts`
Expected: FAIL, cannot resolve `./cycles`.

- [ ] **Step 3: Implementera**

`packages/core/src/analyze/cycles.ts`:

```ts
import type { FileLink } from '../model/types';

export function findCycles(links: FileLink[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const l of links) {
    if (l.typeOnly) continue;
    adjacency.set(l.from, [...(adjacency.get(l.from) ?? []), l.to]);
  }
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];

  const strongConnect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) out.push(component.sort());
    }
  };

  for (const v of adjacency.keys()) if (!index.has(v)) strongConnect(v);
  return out;
}
```

`packages/core/src/analyze/rules.ts`:

```ts
import type { Finding } from '../model/types';
import { msg } from '../text/messages';
import { makeFinding, type AnalysisContext } from './context';
import { findCycles } from './cycles';

const SERVER_ONLY_PACKAGES = new Set(['@prisma/client', 'pg', 'mysql2', 'server-only', 'fs', 'node:fs', 'firebase-admin', 'stripe']);
const MAX_COGNITIVE = 15;
const MAX_NESTING = 4;
const MAX_LINES = 400;

export function findRuleBreaks(ctx: AnalysisContext): Finding[] {
  const out: Finding[] = [];
  for (const f of Object.values(ctx.files)) {
    if (f.directives.includes('use client')) {
      const secrets = f.calls
        .filter((c) => c.kind === 'env' && !c.value.startsWith('NEXT_PUBLIC_') && c.value !== 'NODE_ENV')
        .map((c) => c.value);
      const packages = f.imports.filter((i) => SERVER_ONLY_PACKAGES.has(i.specifier)).map((i) => i.specifier);
      const what = [...new Set([...secrets, ...packages])].join(', ');
      if (what) {
        out.push(
          makeFinding(
            'client-touches-server',
            'certain',
            [f.path],
            [ctx.owner(f.path)],
            msg.clientTouchesServer(f.path, what),
            `${f.path} runs in the browser ("use client") but uses ${what}. Move that code into a server function or API route and call it from here.`,
          ),
        );
      }
      const tables = [...new Set(f.calls.filter((c) => c.kind === 'table').map((c) => c.value))].join(', ');
      if (tables) {
        out.push(
          makeFinding(
            'page-touches-table',
            'likely',
            [f.path],
            [ctx.owner(f.path)],
            msg.pageTouchesTable(f.path, tables),
            `${f.path} reads or writes ${tables} directly from the browser. Move it to a server function, or confirm that row-level security protects these tables.`,
          ),
        );
      }
    }

    for (const p of f.problems) {
      const nodeId = ctx.owner(f.path, p.inFunction);
      if (p.kind === 'hardcoded-secret') {
        out.push(
          makeFinding(
            'hardcoded-secret',
            'certain',
            [f.path],
            [nodeId],
            msg.hardcodedSecret(f.path, p.detail ?? ''),
            `A secret-looking value (${p.detail}) is written directly in ${f.path}:${p.line}. Move it to .env.local and read it with process.env.`,
            String(p.line),
          ),
        );
      } else {
        out.push(
          makeFinding(
            'swallowed-error',
            'likely',
            [f.path],
            [nodeId],
            msg.swallowedError(f.path, p.line),
            `The catch block at ${f.path}:${p.line} hides errors. Log the error and show or return it, or rethrow it.`,
            String(p.line),
          ),
        );
      }
    }

    for (const fn of f.functions) {
      if (fn.cognitive > MAX_COGNITIVE || fn.maxNesting > MAX_NESTING) {
        out.push(
          makeFinding(
            'complex-function',
            'likely',
            [f.path],
            [ctx.owner(f.path, fn.name)],
            msg.complexFunction(fn.name, fn.cognitive),
            `${fn.name} in ${f.path} is hard to follow (complexity ${fn.cognitive}, nesting ${fn.maxNesting}). Split it into smaller named functions without changing behaviour.`,
            fn.name,
          ),
        );
      }
    }

    if (f.lines > MAX_LINES) {
      out.push(
        makeFinding(
          'long-file',
          'likely',
          [f.path],
          [ctx.owner(f.path)],
          msg.longFile(f.path, f.lines),
          `${f.path} has ${f.lines} lines. Split it into smaller files by responsibility.`,
        ),
      );
    }
  }

  for (const cycle of findCycles(ctx.links)) {
    out.push(
      makeFinding(
        'circular-import',
        'certain',
        cycle,
        cycle.map((p) => ctx.owner(p)),
        msg.circularImport(cycle),
        `These files import each other in a circle: ${cycle.join(' -> ')}. Move the shared code into a separate file that both can import.`,
      ),
    );
  }
  return out;
}
```

Ersätt hela `packages/core/src/analyze/index.ts` med:

```ts
import type { Finding } from '../model/types';
import type { AnalysisContext } from './context';
import { findDuplicates } from './duplicates';
import { findRuleBreaks } from './rules';
import { findUnused } from './unused';

export function runAnalyzers(ctx: AnalysisContext): Finding[] {
  return [...findDuplicates(ctx), ...findUnused(ctx), ...findRuleBreaks(ctx)];
}
```

- [ ] **Step 4: Kör testerna och se att de passerar**

Run: `pnpm vitest run packages/core/src`
Expected: PASS. `discountFor` har ett troligt fynd (komplexitet) och används av rutten, så hälsan blir exakt 9.

Om testet i Task 6 som kräver hälsa 10 på alla noder i `clean-app` fallerar: läs fyndet med `console.log(g.findings)`. `clean-app` får inga fynd; ett fynd där betyder fel i analysen, inte i testet.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analyze
git commit -m "feat(core): structure rules, import cycles, complexity and secrets"
```

---

### Task 10: CLI `mapskill scan` och acceptanstest

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/src/scan.ts`, `packages/cli/src/bin.ts`
- Test: `packages/cli/src/scan.test.ts`, `packages/core/src/acceptance.test.ts`

**Interfaces:**
- Consumes: `scanProject`, `ZONE_LABELS`, typer `Graph`, `Zone` från `@mapskill/core` (Task 6-9).
- Produces: `runScan(argv: string[], write?: (s: string) => void): number`; `formatSummary(g: Graph, lang: 'en' | 'sv'): string`; körbart `pnpm scan <dir> [--json] [--lang en|sv]`.

- [ ] **Step 1: Skapa paketet**

`packages/cli/package.json`:

```json
{
  "name": "mapskill",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": { "@mapskill/core": "workspace:*" }
}
```

Run: `pnpm install`
Expected: länkar `@mapskill/core` in i `packages/cli/node_modules`.

- [ ] **Step 2: Skriv de fallerande testerna**

`packages/cli/src/scan.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runScan } from './scan';

const fixture = (name: string) => fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

describe('runScan', () => {
  it('prints a Swedish summary', () => {
    let out = '';
    expect(runScan([fixture('clean-app'), '--lang', 'sv'], (s) => (out += s))).toBe(0);
    expect(out).toContain('Mapskill · clean-app (nextjs)');
    expect(out).toContain('Sidor: 2');
    expect(out).toContain('Fynd: 0 säkra');
  });

  it('prints findings with certainty in English', () => {
    let out = '';
    runScan([fixture('messy-app')], (s) => (out += s));
    expect(out).toMatch(/Findings: \d+ certain, \d+ likely/);
    expect(out).toContain('[certain] Same code with different names');
  });

  it('prints JSON without per-file facts', () => {
    let out = '';
    runScan([fixture('clean-app'), '--json'], (s) => (out += s));
    const parsed = JSON.parse(out) as { nodes: unknown[]; files?: unknown; fileCount: number };
    expect(parsed.nodes.length).toBeGreaterThan(0);
    expect(parsed.files).toBeUndefined();
    expect(parsed.fileCount).toBe(6);
  });
});
```

`packages/core/src/acceptance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scanProject } from './graph/scan';
import { fixture } from './test-helpers';

describe('M1 acceptance criteria from the spec', () => {
  it('finds every planted problem in messy-app', () => {
    const g = scanProject(fixture('messy-app'));
    const has = (kind: string, file: string) => g.findings.some((f) => f.kind === kind && f.files.includes(file));
    expect(has('exact-duplicate', 'lib/date.ts')).toBe(true);
    expect(has('renamed-duplicate', 'lib/date-utils.ts')).toBe(true);
    expect(has('near-duplicate', 'lib/cart.ts')).toBe(true);
    expect(has('unused-export', 'lib/date.ts')).toBe(true);
    expect(has('orphan-file', 'components/OldBanner.tsx')).toBe(true);
    expect(has('client-touches-server', 'app/page.tsx')).toBe(true);
    expect(has('page-touches-table', 'app/page.tsx')).toBe(true);
    expect(has('circular-import', 'lib/cycle-a.ts')).toBe(true);
    expect(has('hardcoded-secret', 'app/api/checkout/route.ts')).toBe(true);
    expect(has('swallowed-error', 'lib/notify.ts')).toBe(true);
    expect(has('complex-function', 'lib/discount.ts')).toBe(true);
  });

  it.each(['clean-app', 'conventions-app'])('reports no certain findings in %s', (name) => {
    const g = scanProject(fixture(name));
    expect(g.findings.filter((f) => f.certainty === 'certain')).toEqual([]);
  });

  it('gives every finding a unique id', () => {
    const g = scanProject(fixture('messy-app'));
    const ids = g.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 3: Kör testerna och se att de fallerar**

Run: `pnpm vitest run packages/cli packages/core/src/acceptance.test.ts`
Expected: CLI-testerna FAIL (cannot resolve `./scan`). Acceptanstestet ska redan PASS; gör det inte, åtgärda analysen i den task som äger fyndtypen innan du går vidare.

- [ ] **Step 4: Implementera CLI:t**

`packages/cli/src/scan.ts`:

```ts
import path from 'node:path';
import { parseArgs } from 'node:util';
import { scanProject, ZONE_LABELS, type Graph, type Zone } from '@mapskill/core';

export function runScan(argv: string[], write: (s: string) => void = (s) => process.stdout.write(s)): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      lang: { type: 'string', default: 'en' },
    },
  });
  const graph = scanProject(path.resolve(positionals[0] ?? '.'));
  if (values.json) {
    const { files, ...rest } = graph;
    write(JSON.stringify({ ...rest, fileCount: Object.keys(files).length }, null, 2) + '\n');
    return 0;
  }
  write(formatSummary(graph, values.lang === 'sv' ? 'sv' : 'en'));
  return 0;
}

export function formatSummary(g: Graph, lang: 'en' | 'sv'): string {
  const zones = Object.keys(ZONE_LABELS) as Zone[];
  const counts = zones.map((z) => `${ZONE_LABELS[z][lang]}: ${g.nodes.filter((n) => n.zone === z).length}`).join(' · ');
  const certain = g.findings.filter((f) => f.certainty === 'certain');
  const likely = g.findings.filter((f) => f.certainty === 'likely');
  const heading =
    lang === 'sv'
      ? `Fynd: ${certain.length} säkra, ${likely.length} troliga`
      : `Findings: ${certain.length} certain, ${likely.length} likely`;
  const lines = [
    `Mapskill · ${path.basename(g.root)} (${g.framework})`,
    counts,
    heading,
    ...[...certain, ...likely].map((f) => `  [${f.certainty}] ${f.message[lang]}`),
  ];
  return lines.join('\n') + '\n';
}
```

`packages/cli/src/bin.ts`:

```ts
#!/usr/bin/env node
import { runScan } from './scan';

const [command, ...rest] = process.argv.slice(2);
if (command === 'scan') {
  process.exit(runScan(rest));
}
process.stderr.write('Usage: mapskill scan [dir] [--json] [--lang en|sv]\n');
process.exit(1);
```

- [ ] **Step 5: Kör hela sviten och typkontrollen**

Run: `pnpm test && pnpm typecheck`
Expected: alla tester PASS, `tsc` utan fel.

- [ ] **Step 6: Prova CLI:t för hand**

Run: `pnpm scan fixtures/messy-app --lang sv`
Expected: rubriken `Mapskill · messy-app (nextjs)`, en rad med antal per zon och en lista med säkra och troliga fynd på svenska, bland annat "Samma kod med olika namn: formatDate, formatDateCopy, formatDay".

- [ ] **Step 7: Commit**

```bash
git add packages/cli packages/core/src/acceptance.test.ts pnpm-lock.yaml
git commit -m "feat(cli): mapskill scan with Swedish and English summaries, M1 acceptance tests"
```

---

## Efter M1

Skriv den detaljerade planen för M2 (inkrementell graf och daemon) utifrån specens avsnitt 4.3 Graf och Daemon samt färdplanens acceptanskriterier. M2 bygger vidare på `scanProject` genom att dela upp den i `buildFromFacts(files, root)` och `applyFileChanges(graph, changed, removed)`.
