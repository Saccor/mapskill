import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixture, tmpProject } from '@mapskill/core/test-helpers';
import { afterEach, describe, expect, it } from 'vitest';
import { request, selfCommand } from '../daemon/client';
import { startDaemon, type DaemonHandle } from '../daemon/daemon';
import { canonicalRoot } from '../project-path';
import { createMcpServer } from './server';

const body = (name: string): string =>
  `export function ${name}(items: number[]) {\n` +
  `  const total = items.reduce((a, b) => a + b, 0);\n` +
  `  const avg = total / Math.max(items.length, 1);\n` +
  `  const big = items.filter((x) => x > avg);\n` +
  `  const small = items.filter((x) => x <= avg);\n` +
  `  console.log(big, small);\n` +
  `  return total;\n` +
  `}\n`;

const handles: DaemonHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.stop('test done')));
});

async function connect(root: string, daemon: () => Promise<{ port: number; token: string; pid: number; version: string; root: string; startedAt: number } | null>) {
  const server = createMcpServer({ root, daemon });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(b);
  return client;
}

const text = (r: unknown): string => ((r as { content: { type: string; text: string }[] }).content[0]?.text ?? '');

describe('MCP server', () => {
  it('lists the five tools', async () => {
    const root = canonicalRoot(tmpProject({ 'package.json': '{}' }));
    const client = await connect(root, async () => null);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['find_similar', 'goal_gaps', 'map_overview', 'node_details', 'turn_findings']);
  });

  it('goal_gaps lists what the chosen goal still misses', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-half-saas-'));
    fs.cpSync(fixture('half-saas'), root, { recursive: true, filter: (src) => !src.split(path.sep).includes('.mapskill') });
    const h = await startDaemon(root, { watch: false });
    handles.push(h);
    const client = await connect(root, async () => h.info);
    expect(text(await client.callTool({ name: 'goal_gaps', arguments: {} }))).toContain('No goal is chosen');
    await request(h.info, 'POST', '/api/goal', { goalId: 'saas-auth-payments' });
    const gaps = text(await client.callTool({ name: 'goal_gaps', arguments: {} }));
    expect(gaps).toMatch(/^Goal: SaaS with login and payments \(\d+\/\d+ done\)\./);
    expect(gaps).toContain('- Checkout endpoint [api-route] — Customers need a way to start a payment. Suggested place: app/api/checkout/route.ts.');
    expect(gaps).toContain('Done:\n- Home page');
  });

  it('answers from a running daemon', async () => {
    const root = canonicalRoot(tmpProject({ 'package.json': '{}', 'lib/a.ts': body('sumA') }));
    const h = await startDaemon(root, { watch: false });
    handles.push(h);
    const client = await connect(root, async () => h.info);

    expect(text(await client.callTool({ name: 'map_overview', arguments: {} }))).toContain('sumA');

    const similar = text(await client.callTool({ name: 'find_similar', arguments: { code: body('sumB') } }));
    // Only the function name differs, so the body hash may count it as the same code or as a renamed copy.
    expect(similar).toMatch(/^1\. sumA in lib\/a\.ts:1-8 \((same code, 1|renamed copy, 0\.95)\)/);
    expect(text(await client.callTool({ name: 'find_similar', arguments: { name: 'qqq' } }))).toContain('No existing function looks like this');
    const missing = await client.callTool({ name: 'find_similar', arguments: {} });
    expect(missing.isError).toBe(true);

    expect(text(await client.callTool({ name: 'node_details', arguments: { path: 'lib/a.ts' } }))).toContain('sumA');
    expect(text(await client.callTool({ name: 'node_details', arguments: { nodeId: 'nope' } }))).toContain('No part of the map matches');

    await request(h.info, 'POST', '/api/turn', { sessionId: 's1' });
    expect(text(await client.callTool({ name: 'turn_findings', arguments: {} }))).toContain('No new findings');
    // A duplicate appears in a file Claude did not touch: not reported. Once touched, it is, with its certainty label.
    fs.writeFileSync(path.join(root, 'lib', 'b.ts'), body('sumB'));
    fs.writeFileSync(path.join(root, 'lib', 'c.ts'), 'export const c = 1;\n');
    await request(h.info, 'POST', '/api/touched', { files: ['lib/c.ts'], sessionId: 's1' });
    expect(text(await client.callTool({ name: 'turn_findings', arguments: {} }))).toContain('No other file uses c');
    expect(text(await client.callTool({ name: 'turn_findings', arguments: {} }))).not.toContain('sumB');
    await request(h.info, 'POST', '/api/touched', { files: ['lib/b.ts'], sessionId: 's1' });
    expect(text(await client.callTool({ name: 'turn_findings', arguments: {} }))).toMatch(/\[(certain|likely)\].*sumB/);
  });

  it('says so when Mapskill is not running or the folder is not a JS project', async () => {
    const js = canonicalRoot(tmpProject({ 'package.json': '{}' }));
    const down = await (await connect(js, async () => null)).callTool({ name: 'map_overview', arguments: {} });
    expect(down.isError).toBe(true);
    expect(text(down)).toBe('Mapskill is not running for this project.');
    const plain = canonicalRoot(tmpProject({ 'notes.txt': '' }));
    let asked = false;
    const other = await (await connect(plain, async () => ((asked = true), null))).callTool({ name: 'map_overview', arguments: {} });
    expect(text(other)).toContain('maps JavaScript and TypeScript projects');
    expect(asked).toBe(false);
  });
});

describe('mapskill mcp over stdio', () => {
  it('lists the tools', async () => {
    const { command, args } = selfCommand();
    const root = canonicalRoot(tmpProject({ 'notes.txt': '' }));
    const transport = new StdioClientTransport({ command, args: [...args, 'mcp'], env: { ...process.env, CLAUDE_PROJECT_DIR: root } as Record<string, string> });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    await client.close();
  }, 30_000);
});
