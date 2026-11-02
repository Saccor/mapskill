import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRelease } from './release';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

function run(cmd: string, args: string[], cwd: string) {
  // npm, npx and claude are .cmd shims on Windows; quote every argument.
  const shell = process.platform === 'win32';
  const quoted = shell ? args.map((a) => `"${a}"`) : args;
  return spawnSync(cmd, quoted, { cwd, shell, encoding: 'utf8' });
}

const claudeOnPath = run('claude', ['--version'], repoRoot).status === 0;

let tmp: string;
let outRoot: string;
let packageDir: string;
let version: string;

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, any>;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-release-'));
  outRoot = path.join(tmp, 'release');
  ({ packageDir, version } = await buildRelease(outRoot));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('release package', () => {
  it('has the exact package.json fields and no dependencies', () => {
    const pkg = readJson(path.join(packageDir, 'package.json'));
    expect(pkg.dependencies).toBeUndefined();
    expect(Object.keys(pkg).sort()).toEqual(['bin', 'description', 'engines', 'files', 'keywords', 'license', 'name', 'type', 'version'].sort());
    expect(pkg.name).toBe('mapskill');
    expect(pkg.license).toBe('MIT');
    expect(pkg.type).toBe('module');
    expect(pkg.bin).toEqual({ mapskill: 'dist/mapskill.mjs' });
    expect(pkg.engines).toEqual({ node: '>=22.12' });
    expect(pkg.files).toEqual(['dist', '.claude-plugin', 'hooks', '.mcp.json', 'skills', 'commands', 'README.md', 'LICENSE']);
    expect(pkg.keywords).toEqual(['claude-code', 'plugin', 'map', 'beginner']);
  });

  it('uses one version everywhere', () => {
    const cli = readJson(path.join(repoRoot, 'packages', 'cli', 'package.json'));
    const pkg = readJson(path.join(packageDir, 'package.json'));
    const plugin = readJson(path.join(packageDir, '.claude-plugin', 'plugin.json'));
    expect(version).toBe(cli.version);
    expect(pkg.version).toBe(cli.version);
    expect(plugin.version).toBe(cli.version);
    expect(readJson(path.join(repoRoot, 'plugin', '.claude-plugin', 'plugin.json')).version).toBeUndefined();
  });

  it('ships plugin files that point at the bundled entry', () => {
    for (const f of ['hooks/hooks.json', '.mcp.json']) {
      const text = fs.readFileSync(path.join(packageDir, f), 'utf8');
      expect(text).toContain('${CLAUDE_PLUGIN_ROOT}/dist/mapskill.mjs');
    }
    expect(fs.existsSync(path.join(packageDir, 'dist', 'ui', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(packageDir, 'skills'))).toBe(true);
    expect(fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8').length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(packageDir, 'LICENSE'), 'utf8')).toContain('Saccor');
  });

  it('writes the local test marketplace and the repo npm marketplace', () => {
    const local = readJson(path.join(outRoot, '.claude-plugin', 'marketplace.json'));
    expect(local.name).toBe('mapskill-local');
    expect(local.plugins[0]).toMatchObject({ name: 'mapskill', source: './mapskill' });
    const repo = readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
    const entry = repo.plugins.find((p: { name: string }) => p.name === 'mapskill');
    expect(entry.source).toEqual({ source: 'npm', package: 'mapskill' });
  });

  it('starts the bundled entry with a node shebang', () => {
    const first = fs.readFileSync(path.join(packageDir, 'dist', 'mapskill.mjs'), 'utf8').split('\n')[0];
    expect(first).toBe('#!/usr/bin/env node');
  });
});

describe('npm pack and clean install', () => {
  let tarball: string;
  let tarballEntries: string[];

  beforeAll(() => {
    const pack = run('npm', ['pack', '--json', '--pack-destination', tmp], packageDir);
    expect(pack.status, pack.stderr).toBe(0);
    const info = JSON.parse(pack.stdout) as Array<{ filename: string; size: number; files: Array<{ path: string }> }>;
    tarball = path.join(tmp, info[0].filename);
    tarballEntries = info[0].files.map((f) => `package/${f.path}`);
    console.log(`mapskill tarball: ${info[0].filename}, ${info[0].size} bytes`);
  });

  it('contains the entry, plugin manifest, hooks and map view', () => {
    for (const f of ['package/dist/mapskill.mjs', 'package/.claude-plugin/plugin.json', 'package/hooks/hooks.json', 'package/dist/ui/index.html']) {
      expect(tarballEntries).toContain(f);
    }
  });

  it('contains no source maps or node_modules', () => {
    expect(tarballEntries.filter((f) => f.endsWith('.map') || f.includes('node_modules'))).toEqual([]);
  });

  it('installs offline into a clean folder and runs', () => {
    const dir = path.join(tmp, 'clean-install');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    const install = run('npm', ['install', '--no-audit', '--no-fund', '--offline', tarball], dir);
    expect(install.status, install.stderr).toBe(0);

    const entry = path.join(dir, 'node_modules', 'mapskill', 'dist', 'mapskill.mjs');
    const scan = spawnSync(process.execPath, [entry, 'scan', path.join(repoRoot, 'fixtures', 'clean-app'), '--json'], { cwd: dir, encoding: 'utf8' });
    expect(scan.status, scan.stderr).toBe(0);
    expect(JSON.parse(scan.stdout).findings).toEqual([]);

    const ver = run('npx', ['--no-install', 'mapskill', '--version'], dir);
    expect(ver.status, ver.stderr).toBe(0);
    expect(ver.stdout).toContain(version);
  });
});

describe('claude plugin validate', () => {
  const validate = claudeOnPath ? it : it.skip;
  if (!claudeOnPath) console.log('claude not on PATH: skipping validation');
  validate('accepts the marketplace root', () => {
    const r = run('claude', ['plugin', 'validate', outRoot], repoRoot);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
  validate('accepts the package dir as a plugin', () => {
    const r = run('claude', ['plugin', 'validate', packageDir], repoRoot);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
