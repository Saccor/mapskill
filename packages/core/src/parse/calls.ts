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

function isSecret(text: string): boolean {
  if (!SECRET_PATTERNS.some((r) => r.test(text))) return false;
  if (text.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(text.split('.')[1], 'base64url').toString('utf8')) as { role?: unknown };
      if (payload.role === 'anon') return false;
    } catch {
      /* not decodable: keep reporting */
    }
  }
  return true;
}

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
    if (ts.isStringLiteralLike(node) && isSecret(node.text)) {
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
