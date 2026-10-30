import { isTestFile } from '../adapters/file-kinds';
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
      const packages = f.imports.filter((i) => !i.typeOnly && SERVER_ONLY_PACKAGES.has(i.specifier)).map((i) => i.specifier);
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
            isTestFile(f.path) ? 'likely' : 'certain',
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
