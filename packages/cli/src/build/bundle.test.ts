import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addLocks } from '../locks';
import { canonicalRoot } from '../project-path';
import { bundlePlugin, type BundleReport } from './bundle';

const repo = path.resolve(import.meta.dirname, '../../../..');
let outdir: string;
let report: BundleReport;

beforeAll(async () => {
  outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-bundle-'));
  report = await bundlePlugin(outdir);
}, 120_000);

afterAll(() => {
  try {
    fs.rmSync(outdir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

const run = (args: string[], input?: unknown, env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [report.entry, ...args], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env },
    timeout: 30_000,
  });

describe('plugin bundle', () => {
  it('keeps the TypeScript compiler and core out of the hook path', () => {
    expect(report.hookClosureInputs.some((p) => p.includes('packages/cli/src/hooks/run.ts'))).toBe(true);
    expect(report.hookClosureInputs.filter((p) => p.includes('node_modules/typescript/'))).toEqual([]);
    expect(report.hookClosureInputs.filter((p) => p.includes('packages/core/src/'))).toEqual([]);
  });

  it('runs the lock hook from the bundle', () => {
    const root = canonicalRoot(tmpProject({ 'package.json': '{}', 'lib/a.ts': '' }));
    addLocks(root, [path.join(root, 'lib', 'a.ts')]);
    const r = run(['hook', 'pre-tool-use'], { cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'lib', 'a.ts') } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('lib/a.ts');
  });

  it('runs scan from the bundle (the TypeScript compiler loads lazily)', () => {
    const r = run(['scan', path.join(repo, 'fixtures', 'clean-app'), '--json']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).framework).toBe('nextjs');
  });

  it('has plugin files that point at commands the bundle knows', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(repo, 'plugin', 'hooks', 'hooks.json'), 'utf8')) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command: string; args: string[]; timeout: number }[] }[]>;
    };
    expect(Object.keys(hooks.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
    for (const groups of Object.values(hooks.hooks)) {
      for (const h of groups.flatMap((g) => g.hooks)) {
        expect(h.command).toBe('node');
        expect(h.args[0]).toBe('${CLAUDE_PLUGIN_ROOT}/dist/mapskill.mjs');
        expect(h.args[1]).toBe('hook');
        expect(['session-start', 'user-prompt-submit', 'pre-tool-use', 'post-tool-use', 'stop']).toContain(h.args[2]);
      }
    }
    const mcp = JSON.parse(fs.readFileSync(path.join(repo, 'plugin', '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(mcp.mcpServers.mapskill.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/dist/mapskill.mjs', 'mcp']);
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string };
    expect(manifest.name).toBe('mapskill');
    expect(fs.readFileSync(path.join(repo, 'plugin', 'skills', 'mapskill', 'SKILL.md'), 'utf8')).toMatch(/^---\nname: mapskill\n/);
  });
});

describe('plugin bundle with the map view', () => {
  let out: string;
  let withUi: BundleReport;
  const roots: string[] = [];

  beforeAll(async () => {
    const ui = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-fake-ui-'));
    fs.writeFileSync(path.join(ui, 'index.html'), '<!doctype html><title>Fake map</title>');
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-bundle-ui-'));
    withUi = await bundlePlugin(out, { uiDir: ui });
  }, 120_000);

  afterAll(() => {
    for (const r of roots) spawnSync(process.execPath, [withUi.entry, 'stop', r], { timeout: 20_000 });
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('copies the map view next to the bundle and the bundled daemon serves it', async () => {
    expect(withUi.ui).toBe(true);
    expect(fs.existsSync(path.join(out, 'ui', 'index.html'))).toBe(true);
    const root = tmpProject({ 'package.json': '{}', 'lib/a.ts': 'export const a = 1;\n' });
    roots.push(root);
    const r = spawnSync(process.execPath, [withUi.entry, 'open', root, '--no-browser'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, MAPSKILL_UI_DIR: '' } });
    expect(r.status).toBe(0);
    const url = /Mapskill map: (\S+)/.exec(r.stdout)![1];
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Fake map');
  }, 60_000);
});

describe('plugin bundle without the map view', () => {
  it('skips the map view when uiDir is null', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-bundle-noui-'));
    try {
      const r = await bundlePlugin(out, { uiDir: null });
      expect(r.ui).toBe(false);
      expect(fs.existsSync(path.join(out, 'ui'))).toBe(false);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
