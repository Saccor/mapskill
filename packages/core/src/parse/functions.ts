import ts from 'typescript';
import { isPropertyNamePosition } from './ast-utils';
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
  const bound = boundNames(node);
  const renamed = tokens.map((t) =>
    t.kind === ts.SyntaxKind.Identifier && bound.has(t.getText(sf)) && !isPropertyNamePosition(t as ts.Identifier)
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

/** Names declared inside the function: parameters (incl. destructuring), variables, nested functions/classes and catch variables. */
function boundNames(node: FnNode): Set<string> {
  const out = new Set<string>();
  const addPattern = (n: ts.BindingName): void => {
    if (ts.isIdentifier(n)) out.add(n.text);
    else for (const el of n.elements) if (ts.isBindingElement(el)) addPattern(el.name);
  };
  const visit = (x: ts.Node): void => {
    if (ts.isParameter(x) || ts.isVariableDeclaration(x)) addPattern(x.name);
    else if ((ts.isFunctionDeclaration(x) || ts.isClassDeclaration(x)) && x.name) out.add(x.name.text);
    ts.forEachChild(x, visit);
  };
  for (const p of node.parameters) visit(p);
  if (node.body) visit(node.body);
  return out;
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
