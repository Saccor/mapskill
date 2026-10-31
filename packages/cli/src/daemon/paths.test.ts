import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { writeDaemonInfo } from './info';
import { ensureGitignore, readJson, writeJsonAtomic } from './paths';

describe('ensureGitignore', () => {
  it('appends the Mapskill lines once', () => {
    const root = tmpProject({ '.gitignore': 'node_modules' });
    expect(ensureGitignore(root)).toBe(true);
    expect(ensureGitignore(root)).toBe(false);
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules\n\n# Mapskill (local map data)\n.mapskill/*\n!.mapskill/goal.yaml\n',
    );
  });

  it('leaves projects without .gitignore alone', () => {
    const root = tmpProject({ 'a.ts': '' });
    expect(ensureGitignore(root)).toBe(false);
    expect(fs.existsSync(path.join(root, '.gitignore'))).toBe(false);
  });

  it('accepts an existing .mapskill/ line', () => {
    const root = tmpProject({ '.gitignore': 'node_modules/\n.mapskill/\n' });
    expect(ensureGitignore(root)).toBe(false);
  });
});

describe('writeJsonAtomic', () => {
  it('replaces the file and leaves no temporary files', () => {
    const root = tmpProject({});
    const file = path.join(root, 'x.json');
    writeJsonAtomic(file, { a: 1 });
    writeJsonAtomic(file, { a: 2 });
    expect(readJson<{ a: number }>(file)).toEqual({ a: 2 });
    expect(fs.readdirSync(root)).toEqual(['x.json']);
  });

  it('reads a missing or broken file as null', () => {
    const root = tmpProject({ 'bad.json': '{nope' });
    expect(readJson(path.join(root, 'bad.json'))).toBeNull();
    expect(readJson(path.join(root, 'missing.json'))).toBeNull();
  });
});

describe('file permissions (POSIX)', () => {
  it.skipIf(process.platform === 'win32')('keeps the token private: daemon.json 0600 in a 0700 .mapskill', () => {
    const root = tmpProject({});
    writeDaemonInfo(root, { pid: 1, port: 2, token: 'ab', version: 'v', root, startedAt: 0 });
    expect(fs.statSync(path.join(root, '.mapskill')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(root, '.mapskill', 'daemon.json')).mode & 0o777).toBe(0o600);
    const file = path.join(root, 'x.json');
    writeJsonAtomic(file, {}, 0o600);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
