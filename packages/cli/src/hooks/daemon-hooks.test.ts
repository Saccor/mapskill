// packages/cli/src/hooks/daemon-hooks.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { StopAnswer } from '@mapskill/core';
import { tmpProject } from '@mapskill/core/test-helpers';
import { afterEach, describe, expect, it } from 'vitest';
import { request } from '../daemon/client';
import { startDaemon, type DaemonHandle } from '../daemon/daemon';
import { addLocks } from '../locks';
import { canonicalRoot } from '../project-path';
import { postToolUse } from './post-tool-use';
import { runHook } from './run';
import type { HookContext } from './types';
import { stop } from './stop';
import { formatRequests, userPromptSubmit } from './user-prompt-submit';
import { sessionContext } from './session-start';
import { formatStopReason } from './stop';

const body = (name: string): string =>
  `export function ${name}(items: number[]) {\n` +
  `  const total = items.reduce((a, b) => a + b, 0);\n` +
  `  const avg = total / Math.max(items.length, 1);\n` +
  `  const big = items.filter((x) => x > avg);\n` +
  `  const small = items.filter((x) => x <= avg);\n` +
  `  console.log(big, small);\n` +
  `  return total;\n` +
  `}\n`;
const project = (): string =>
  canonicalRoot(tmpProject({ 'package.json': '{"dependencies":{"next":"15.0.0"}}', 'lib/a.ts': body('sumA') }));
const run = (event: string, root: string, input: Record<string, unknown>) =>
  runHook(event, { stdin: Readable.from([JSON.stringify({ session_id: 's1', cwd: root, ...input })]), env: { CLAUDE_PROJECT_DIR: root } });

const handles: DaemonHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.stop('test done')));
});
async function daemon(root: string): Promise<DaemonHandle> {
  const h = await startDaemon(root, { watch: false });
  handles.push(h);
  await h.ready;
  return h;
}

describe('hooks with a daemon', () => {
  it('logs a line when a hook skips its request for lack of time', async () => {
    const root = project();
    await daemon(root);
    const ctx = (input: HookContext['input']): HookContext => ({ input, root, jsProject: true, env: {}, deadline: Date.now() });
    const edited = { tool_name: 'Write', tool_input: { file_path: path.join(root, 'lib', 'a.ts') } };
    expect(await userPromptSubmit(ctx({ session_id: 's1' }))).toEqual({ exitCode: 0 });
    expect(await postToolUse(ctx(edited))).toEqual({ exitCode: 0 });
    expect(await stop(ctx({ session_id: 's1' }))).toEqual({ exitCode: 0 });
    const log = fs.readFileSync(path.join(root, '.mapskill', 'log.txt'), 'utf8');
    for (const event of ['user-prompt-submit', 'post-tool-use', 'stop']) expect(log).toContain(`${event}: skipped: no time left`);
  });

  it('user-prompt-submit hands queued map requests to Claude once', async () => {
    const root = project();
    const h = await daemon(root);
    await request(h.info, 'POST', '/api/requests', { kind: 'explain', text: 'Explain sumA in plain words' });
    const first = await run('user-prompt-submit', root, { prompt: 'go' });
    const out = JSON.parse(first.stdout!) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(out.hookSpecificOutput.additionalContext).toContain('1. Explain sumA in plain words');
    expect(await run('user-prompt-submit', root, { prompt: 'again' })).toEqual({ exitCode: 0 });
  });

  it('session-start gives Claude the map address', async () => {
    const root = project();
    const h = await daemon(root);
    const r = await run('session-start', root, { source: 'startup' });
    const ctx = (JSON.parse(r.stdout!) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain(`http://127.0.0.1:${h.info.port}/?t=${h.info.token}`);
  });

  it('session-start returns context with the locks', async () => {
    const root = project();
    await daemon(root);
    addLocks(root, [path.join(root, 'lib', 'a.ts')], 'Summor');
    const r = await run('session-start', root, { source: 'startup' });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout!) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(out.hookSpecificOutput.additionalContext).toContain('find_similar');
    expect(out.hookSpecificOutput.additionalContext).toContain('lib/a.ts (Summor)');
  });

  it('a full turn: prompt, edit, stop blocks once with the duplicate', async () => {
    const root = project();
    const h = await daemon(root);
    expect(await run('user-prompt-submit', root, { prompt: 'add sums' })).toEqual({ exitCode: 0 });
    fs.writeFileSync(path.join(root, 'lib', 'b.ts'), body('sumB'));
    expect(
      await run('post-tool-use', root, { tool_name: 'Write', tool_use_id: 't1', tool_input: { file_path: path.join(root, 'lib', 'b.ts') } }),
    ).toEqual({ exitCode: 0 });
    const blocked = await run('stop', root, { stop_hook_active: false });
    expect(blocked.exitCode).toBe(0);
    const decision = JSON.parse(blocked.stdout!) as { decision: string; reason: string };
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('lib/b.ts');
    expect(decision.reason).toContain('What to do:');
    expect(await run('stop', root, { stop_hook_active: true })).toEqual({ exitCode: 0 });
    expect(await run('stop', root, { stop_hook_active: false })).toEqual({ exitCode: 0 });
    expect((await request<{ ok: boolean }>(h.info, 'GET', '/api/status')).ok).toBe(true);
  });

  it('post-tool-use reports a Bash command without a file list', async () => {
    const root = project();
    await daemon(root);
    await run('user-prompt-submit', root, { prompt: 'copy it' });
    fs.writeFileSync(path.join(root, 'lib', 'c.ts'), body('sumC'));
    expect(await run('post-tool-use', root, { tool_name: 'Bash', tool_input: { command: 'cp lib/a.ts lib/c.ts' } })).toEqual({ exitCode: 0 });
    const decision = JSON.parse((await run('stop', root, {})).stdout!) as { reason: string };
    expect(decision.reason).toContain('lib/c.ts');
  });
});

describe('hooks without a daemon', () => {
  it('post-tool-use and stop do nothing and start nothing', async () => {
    const root = project();
    expect(await run('post-tool-use', root, { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'lib', 'a.ts') } })).toEqual({ exitCode: 0 });
    expect(await run('stop', root, {})).toEqual({ exitCode: 0 });
    expect(fs.existsSync(path.join(root, '.mapskill', 'daemon.json'))).toBe(false);
  });

  it('does nothing at all outside a JS project', async () => {
    const root = canonicalRoot(tmpProject({ 'notes.txt': 'hi' }));
    for (const event of ['session-start', 'user-prompt-submit', 'post-tool-use', 'stop']) {
      expect(await run(event, root, { tool_name: 'Bash', tool_input: { command: 'ls' } })).toEqual({ exitCode: 0 });
    }
    expect(fs.existsSync(path.join(root, '.mapskill'))).toBe(false);
  });
});

describe('formatStopReason', () => {
  it('numbers the findings and mentions the rest', () => {
    const f = (n: number) => ({
      id: `x${n}`, kind: 'exact-duplicate' as const, certainty: 'certain' as const, nodeIds: [], files: ['a.ts'],
      message: { en: `Problem ${n}`, sv: '' }, instruction: `Fix ${n}`,
    });
    const answer: StopAnswer = { turnId: 't', unknownTurn: false, alreadyReported: false, total: 7, findings: [1, 2, 3, 4, 5].map(f) };
    const text = formatStopReason(answer);
    expect(text).toContain('Mapskill found 7 new problems');
    expect(text).toContain('1. Problem 1\n   What to do: Fix 1');
    expect(text).toContain('(2 more not shown');
    expect(formatStopReason({ ...answer, total: 1, findings: [f(1)] })).toContain('found 1 new problem in');
  });
});

describe('formatRequests', () => {
  it('indents continuation lines so the numbered list stays intact', () => {
    const r = (id: string, text: string) => ({ id, kind: 'custom' as const, text, createdAt: 1, status: 'pending' as const });
    const text = formatRequests([r('a', 'first\nsecond\r\nthird'), r('b', 'other')]);
    expect(text).toContain('1. first\n   second\n   third\n2. other');
  });
});

describe('sessionContext fallbacks', () => {
  it('says so when the daemon did not start', () => {
    expect(sessionContext(null, [])).toContain('could not start');
  });

  it('says so when locks.json cannot be read', () => {
    expect(sessionContext({ port: 1, token: 't' }, null)).toContain('cannot read .mapskill/locks.json');
  });
});
