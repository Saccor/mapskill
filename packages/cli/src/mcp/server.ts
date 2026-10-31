import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Finding, SimilarMatch } from '@mapskill/core';
import { z } from 'zod';
import { DaemonRequestError, ensureDaemon, request } from '../daemon/client';
import { DAEMON_VERSION, type DaemonInfo } from '../daemon/info';
import { isJsProject } from '../hooks/input';
import { canonicalRoot } from '../project-path';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

const REASONS: Record<SimilarMatch['reason'], string> = {
  'same-code': 'same code',
  'renamed-copy': 'renamed copy',
  'similar-code': 'similar code',
  'similar-name': 'similar name',
};

export function formatMatches(matches: SimilarMatch[]): string {
  if (matches.length === 0) return 'No existing function looks like this. Writing a new one is fine.';
  const lines = matches.map(
    (m, i) =>
      `${i + 1}. ${m.name} in ${m.file}:${m.startLine}-${m.endLine} (${REASONS[m.reason]}, ${m.score})` +
      (m.nodeId ? ` [node ${m.nodeId}]` : ''),
  );
  lines.push('Reuse or extend one of these if it fits; import it instead of writing a copy.');
  return lines.join('\n');
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'No new findings in the current turn.';
  return findings.map((f) => `- [${f.certainty}] ${f.message.en}\n  What to do: ${f.instruction}`).join('\n');
}

export function createMcpServer(options: { root: string; daemon: () => Promise<DaemonInfo | null> }): McpServer {
  const server = new McpServer({ name: 'mapskill', version: DAEMON_VERSION });

  /** Runs a tool body against the daemon; turns every failure into a one-sentence tool error. */
  const withDaemon = async (body: (info: DaemonInfo) => Promise<ToolResult>): Promise<ToolResult> => {
    if (!isJsProject(options.root)) {
      return fail('Mapskill maps JavaScript and TypeScript projects; this folder has no package.json or tsconfig.json.');
    }
    try {
      const info = await options.daemon();
      if (!info) return fail('Mapskill is not running for this project.');
      return await body(info);
    } catch (err) {
      return fail(`Mapskill could not answer: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  server.registerTool(
    'map_overview',
    {
      description:
        'A short map of this project: its zones (pages, server, building blocks, shared helpers, data), the parts in each, and their health. Call it to see where new code belongs.',
      inputSchema: { maxNodes: z.number().int().min(10).max(300).optional() },
    },
    async ({ maxNodes }) =>
      withDaemon(async (info) => {
        const q = maxNodes ? `?maxNodes=${maxNodes}` : '';
        return ok((await request<{ text: string }>(info, 'GET', `/api/overview${q}`, undefined, 10_000)).text);
      }),
  );

  server.registerTool(
    'find_similar',
    {
      description:
        'Before writing a new function or component: give its planned name and/or code, and get up to 5 existing functions in this project that look the same, so you can reuse one instead of writing a copy.',
      inputSchema: { name: z.string().max(200).optional(), code: z.string().max(20_000).optional() },
    },
    async ({ name, code }) => {
      if (!name?.trim() && !code?.trim()) return fail('Give a name, code, or both.');
      return withDaemon(async (info) => {
        const { matches } = await request<{ matches: SimilarMatch[] }>(info, 'POST', '/api/similar', { name, code }, 10_000);
        return ok(formatMatches(matches));
      });
    },
  );

  server.registerTool(
    'node_details',
    {
      description:
        'Details about one part of the map (by node id from map_overview or find_similar) or about the parts in one file (by project-relative path): who uses it, what it uses, and its findings.',
      inputSchema: { nodeId: z.string().max(500).optional(), path: z.string().max(500).optional() },
    },
    async ({ nodeId, path }) => {
      if (!nodeId && !path) return fail('Give a nodeId or a path.');
      return withDaemon(async (info) => {
        const q = nodeId ? `id=${encodeURIComponent(nodeId)}` : `path=${encodeURIComponent(path!)}`;
        try {
          return ok((await request<{ text: string }>(info, 'GET', `/api/node?${q}`, undefined, 10_000)).text);
        } catch (err) {
          if (err instanceof DaemonRequestError && err.status === 404) return ok('No part of the map matches that. Use map_overview to find ids.');
          throw err;
        }
      });
    },
  );

  server.registerTool(
    'turn_findings',
    {
      description: 'Problems Mapskill found in the code changed during the current turn (new duplicates, unused code, rule breaks).',
      inputSchema: {},
    },
    async () =>
      withDaemon(async (info) => {
        const { findings } = await request<{ findings: Finding[] }>(info, 'GET', '/api/findings?session=latest', undefined, 10_000);
        return ok(formatFindings(findings));
      }),
  );

  return server;
}

/** `mapskill mcp`: serves the tools over stdio until Claude Code closes the pipe. */
export async function runMcp(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const root = canonicalRoot(env.CLAUDE_PROJECT_DIR || process.cwd());
  const server = createMcpServer({ root, daemon: () => ensureDaemon(root, { timeoutMs: 8000 }) });
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.stdin.once('end', () => resolve());
  });
  await server.connect(transport);
  await closed;
  return 0;
}
