// packages/cli/src/hooks/hooks.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { addLocks } from '../locks';
import { canonicalRoot } from '../project-path';
import { editedFile, hookRoot, isJsProject, readHookInput } from './input';
import { runHook, timeLeft, type HookHandler } from './run';

const stdin = (value: unknown): Readable => Readable.from([typeof value === 'string' ? value : JSON.stringify(value)]);
const env = (root: string): NodeJS.ProcessEnv => ({ CLAUDE_PROJECT_DIR: root });
const project = (): string => canonicalRoot(tmpProject({ 'package.json': '{}', 'lib/pay/charge.ts': '', 'lib/a.ts': '' }));
const edit = (root: string, rel: string) => ({
  session_id: 's1',
  cwd: root,
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_input: { file_path: path.join(root, rel), old_string: 'a', new_string: 'b' },
});

describe('hook input', () => {
  it('reads JSON from stdin and survives garbage', async () => {
    expect(await readHookInput(stdin({ session_id: 'x' }))).toEqual({ session_id: 'x' });
    expect(await readHookInput(stdin('not json'))).toEqual({});
    expect(await readHookInput(stdin(''))).toEqual({});
  });

  it('finds the root and whether it is a JS project', () => {
    const root = project();
    expect(hookRoot({ cwd: '/elsewhere' }, env(root))).toBe(root);
    expect(hookRoot({ cwd: root }, {})).toBe(root);
    expect(isJsProject(root)).toBe(true);
    expect(isJsProject(canonicalRoot(tmpProject({ 'notes.txt': '' })))).toBe(false);
  });

  it('never treats the home folder as a project, so session-start does nothing there', async () => {
    const home = project();
    expect(isJsProject(home, home)).toBe(false);
    if (process.platform === 'win32') expect(isJsProject(home.toUpperCase(), home)).toBe(false);
    const seen: boolean[] = [];
    const spy: HookHandler = async (ctx) => (seen.push(ctx.jsProject), { exitCode: 0 });
    await runHook('session-start', { stdin: stdin({}), env: env(home), home }, { 'session-start': spy });
    expect(seen).toEqual([false]);
    // The built-in handler: no daemon, no .mapskill folder, no context for Claude.
    expect(await runHook('session-start', { stdin: stdin({}), env: env(home), home })).toEqual({ exitCode: 0 });
    expect(fs.existsSync(path.join(home, '.mapskill'))).toBe(false);
  });

  it('finds the edited file in every tool shape', () => {
    expect(editedFile({ tool_input: { file_path: '/a.ts' } })).toBe('/a.ts');
    expect(editedFile({ tool_input: { notebook_path: '/n.ipynb' } })).toBe('/n.ipynb');
    expect(editedFile({ tool_input: { command: 'ls' } })).toBeUndefined();
    expect(editedFile({})).toBeUndefined();
  });
});

describe('pre-tool-use', () => {
  it('allows an edit when nothing is locked', async () => {
    const root = project();
    expect(await runHook('pre-tool-use', { stdin: stdin(edit(root, 'lib/a.ts')), env: env(root) })).toEqual({ exitCode: 0 });
  });

  it('blocks an edit inside a locked folder with the label', async () => {
    const root = project();
    addLocks(root, [path.join(root, 'lib', 'pay')], 'Betalning');
    const result = await runHook('pre-tool-use', { stdin: stdin(edit(root, 'lib/pay/charge.ts')), env: env(root) });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('"Betalning"');
    expect(result.stderr).toContain('lib/pay/charge.ts');
    expect(result.stderr).toContain(`mapskill unlock "${path.join(root, 'lib/pay/')}"`);
    expect(result.stderr).toContain('Ask the user first.');
    expect(result.stderr).not.toContain('Mapskill map');
  });

  it('blocks a new file in a locked folder and leaves other files alone', async () => {
    const root = project();
    addLocks(root, [path.join(root, 'lib', 'pay')]);
    const write = { ...edit(root, 'lib/pay/new.ts'), tool_name: 'Write', tool_input: { file_path: path.join(root, 'lib/pay/new.ts'), content: 'x' } };
    expect((await runHook('pre-tool-use', { stdin: stdin(write), env: env(root) })).exitCode).toBe(2);
    expect((await runHook('pre-tool-use', { stdin: stdin(edit(root, 'lib/a.ts')), env: env(root) })).exitCode).toBe(0);
    expect((await runHook('pre-tool-use', { stdin: stdin(edit(root, '../outside.ts')), env: env(root) })).exitCode).toBe(0);
  });

  it('blocks a lock stored in the nearest package root when the hook root is an outer folder', async () => {
    const root = canonicalRoot(
      tmpProject({ 'package.json': '{}', 'apps/web/package.json': '{}', 'apps/web/lib/a.ts': '', 'apps/web/lib/b.ts': '' }),
    );
    const subRoot = path.join(root, 'apps', 'web');
    addLocks(subRoot, [path.join(subRoot, 'lib', 'a.ts')]);
    expect(fs.existsSync(path.join(subRoot, '.mapskill', 'locks.json'))).toBe(true);
    const blocked = await runHook('pre-tool-use', { stdin: stdin(edit(root, 'apps/web/lib/a.ts')), env: env(root) });
    expect(blocked.exitCode).toBe(2);
    expect(blocked.stderr).toContain('lib/a.ts');
    expect(blocked.stderr).toContain(`mapskill unlock "${path.join(subRoot, 'lib/a.ts')}"`);
    expect((await runHook('pre-tool-use', { stdin: stdin(edit(root, 'apps/web/lib/b.ts')), env: env(root) })).exitCode).toBe(0);
    // a broken locks.json in the sub-package fails closed too
    fs.writeFileSync(path.join(subRoot, '.mapskill', 'locks.json'), '{ broken');
    const broken = await runHook('pre-tool-use', { stdin: stdin(edit(root, 'apps/web/lib/b.ts')), env: env(root) });
    expect(broken.exitCode).toBe(2);
    expect(broken.stderr).toContain('cannot read .mapskill/locks.json');
  });

  it('fails closed when locks.json is broken', async () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.mapskill'), { recursive: true });
    fs.writeFileSync(path.join(root, '.mapskill', 'locks.json'), '{ broken');
    const result = await runHook('pre-tool-use', { stdin: stdin(edit(root, 'lib/a.ts')), env: env(root) });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('cannot read .mapskill/locks.json');
  });
});

describe('runHook', () => {
  it('fails open and logs when a handler throws or hangs', async () => {
    const root = project();
    const boom: HookHandler = async () => {
      throw new Error('kaboom');
    };
    expect(await runHook('stop', { stdin: stdin({}), env: env(root) }, { stop: boom })).toEqual({ exitCode: 0 });
    const log = fs.readFileSync(path.join(root, '.mapskill', 'log.txt'), 'utf8');
    expect(log).toMatch(/stop: .*kaboom/);
    const hang: HookHandler = () => new Promise(() => {});
    const started = Date.now();
    expect(await runHook('user-prompt-submit', { stdin: stdin({}), env: env(root) }, { 'user-prompt-submit': hang })).toEqual({ exitCode: 0 });
    expect(Date.now() - started).toBeLessThan(6000);
    expect(fs.readFileSync(path.join(root, '.mapskill', 'log.txt'), 'utf8')).toMatch(/user-prompt-submit: timed out/);
  }, 10_000);

  it('gives handlers an absolute deadline and a time budget', async () => {
    const root = project();
    let seen: { deadline: number; left: number } | undefined;
    const spy: HookHandler = async (ctx) => {
      seen = { deadline: ctx.deadline, left: timeLeft(ctx) };
      return { exitCode: 0 };
    };
    const before = Date.now();
    await runHook('pre-tool-use', { stdin: stdin({}), env: env(root) }, { 'pre-tool-use': spy });
    expect(seen!.deadline).toBeGreaterThanOrEqual(before + 3900);
    expect(seen!.deadline).toBeLessThanOrEqual(Date.now() + 4000);
    expect(seen!.left).toBeLessThanOrEqual(4000);
    expect(seen!.left).toBeGreaterThan(0);
  });

  it('counts a stalled stdin inside the deadline', async () => {
    const root = project();
    const stalled = new Readable({ read() {} });
    const quick: HookHandler = async () => ({ exitCode: 0 });
    const started = Date.now();
    expect(await runHook('pre-tool-use', { stdin: stalled, env: env(root) }, { 'pre-tool-use': quick })).toEqual({ exitCode: 0 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(4500);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(3000); // stdin limit is min(2000, 4000 / 4) = 1000 ms
  }, 10_000);

  it('logs nothing outside a JS project and rejects unknown events', async () => {
    const root = canonicalRoot(tmpProject({ 'notes.txt': '' }));
    const boom: HookHandler = async () => {
      throw new Error('kaboom');
    };
    await runHook('stop', { stdin: stdin({}), env: env(root) }, { stop: boom });
    expect(fs.existsSync(path.join(root, '.mapskill'))).toBe(false);
    const unknown = await runHook('nope', { stdin: stdin({}), env: env(root) });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('Unknown hook event');
  });
});
