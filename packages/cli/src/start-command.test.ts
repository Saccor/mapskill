import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { selfCommand } from './daemon/client';
import { looksLikeProject, runStart } from './start-command';
import { VERSION } from './version';

function bin(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const { command, args: base } = selfCommand();
  const r = spawnSync(command, [...base, ...args], { encoding: 'utf8', timeout: 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('looksLikeProject', () => {
  it('recognises a folder with a project marker', () => {
    expect(looksLikeProject(tmpProject({ 'package.json': '{}' }))).toBe(true);
    expect(looksLikeProject(tmpProject({ 'go.mod': 'module x\n' }))).toBe(true);
  });

  it('rejects an empty folder', () => {
    expect(looksLikeProject(tmpProject({ 'notes.txt': 'hi' }))).toBe(false);
  });

  it('never accepts the home folder or a disk root, even with a marker', () => {
    const home = tmpProject({ 'package.json': '{}' });
    expect(looksLikeProject(home)).toBe(true);
    expect(looksLikeProject(home, home)).toBe(false);
    if (process.platform === 'win32') expect(looksLikeProject(home.toUpperCase(), home)).toBe(false);
    expect(looksLikeProject(os.homedir())).toBe(false);
    expect(looksLikeProject(path.parse(process.cwd()).root)).toBe(false);
  });
});

describe('runStart', () => {
  it('opens the map in a project folder and passes the flags on', async () => {
    const cwd = tmpProject({ 'package.json': '{}' });
    const calls: string[][] = [];
    const open = async (args: string[]) => (calls.push(args), 0);
    expect(await runStart([], { cwd, open, write: () => {} })).toBe(0);
    expect(await runStart(['--no-browser'], { cwd, open, write: () => {} })).toBe(0);
    expect(calls).toEqual([[cwd], [cwd, '--no-browser']]);
  });

  it('prints friendly help and exits 1 outside a project', async () => {
    const cwd = tmpProject({ 'notes.txt': 'hi' });
    const out: string[] = [];
    let opened = false;
    const code = await runStart([], { cwd, open: async () => ((opened = true), 0), write: (s) => void out.push(s), lang: 'en' });
    expect(code).toBe(1);
    expect(opened).toBe(false);
    const text = out.join('');
    expect(text).toContain('npx mapskill');
    expect(text).toContain('/plugin marketplace add Saccor/mapskill');
    expect(text).toContain('/plugin install mapskill@mapskill-marketplace');
    expect(text).toContain('npx mapskill --help');
  });

  it('speaks Swedish when asked to', async () => {
    const out: string[] = [];
    await runStart([], { cwd: tmpProject({}), open: async () => 0, write: (s) => void out.push(s), lang: 'sv' });
    const text = out.join('');
    expect(text).toContain('Gå till din projektmapp');
    expect(text).toContain('/plugin install mapskill@mapskill-marketplace');
  });
});

describe('VERSION', () => {
  it('equals the version in packages/cli/package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

describe('mapskill bin (subprocess)', () => {
  it('prints the version and exits 0', () => {
    for (const flag of ['--version', '-v']) {
      const r = bin([flag]);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(`${VERSION}\n`);
    }
  }, 60_000);

  it('prints usage on stdout for --help and -h', () => {
    for (const flag of ['--help', '-h']) {
      const r = bin([flag]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('mapskill scan');
      expect(r.stdout).toMatch(/^\s+mapskill\s+open the map for this folder/m);
      expect(r.stdout).toContain('mapskill stats');
    }
  }, 60_000);

  it('keeps the stats flags next to the command, like the other usage lines', () => {
    const r = bin(['--help']);
    expect(r.stdout).toMatch(/^ {2}mapskill stats \[--json\] \[--lang en\|sv\] {3}show how Mapskill has been used/m);
    expect(r.stdout).not.toMatch(/^ {2}mapskill stats {2,}show/m);
  }, 60_000);

  it('still prints usage on stderr and exits 1 for an unknown command', () => {
    const r = bin(['nope']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Usage:');
  }, 60_000);
});
