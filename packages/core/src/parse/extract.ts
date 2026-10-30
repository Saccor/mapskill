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
