import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { afterEach, describe, expect, it } from 'vitest';
import { sleep, waitFor } from '../test-utils';
import { watchProject, type ProjectWatcher, type WatchEvent } from './watcher';

let watcher: ProjectWatcher | undefined;
afterEach(async () => {
  await watcher?.close();
  watcher = undefined;
});

describe('watchProject', () => {
  it('reports source and config changes with project-relative paths', async () => {
    const root = tmpProject({ 'lib/a.ts': 'export const a = 1;\n', 'package.json': '{}' });
    const events: WatchEvent[] = [];
    watcher = await watchProject(root, (e) => events.push(e));
    fs.writeFileSync(path.join(root, 'lib/b.ts'), 'export const b = 1;\n');
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
    await waitFor(() => events.some((e) => e.rel === 'lib/b.ts') && events.some((e) => e.rel === 'package.json'));
    expect(events.every((e) => !e.rel.includes('\\'))).toBe(true);
  });

  it('stays silent about skipped folders', async () => {
    const root = tmpProject({ 'lib/a.ts': '', 'node_modules/p/index.js': '' });
    const events: WatchEvent[] = [];
    watcher = await watchProject(root, (e) => events.push(e));
    fs.writeFileSync(path.join(root, 'node_modules/p/index.js'), 'changed');
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist/out.js'), '');
    fs.writeFileSync(path.join(root, 'lib/a.ts'), 'export const a = 2;\n');
    await waitFor(() => events.some((e) => e.rel === 'lib/a.ts'));
    await sleep(300);
    expect(events.filter((e) => e.rel.startsWith('node_modules') || e.rel.startsWith('dist'))).toEqual([]);
  });

  it('stays silent about folders the project .gitignore excludes', async () => {
    const root = tmpProject({ 'lib/a.ts': '', 'tmp/old.ts': '', '.gitignore': 'tmp/\n*.log\n' });
    const events: WatchEvent[] = [];
    watcher = await watchProject(root, (e) => events.push(e));
    fs.writeFileSync(path.join(root, 'tmp/x.ts'), 'export const x = 1;\n');
    fs.mkdirSync(path.join(root, 'tmp/deep'));
    fs.writeFileSync(path.join(root, 'tmp/deep/y.ts'), 'export const y = 1;\n');
    fs.writeFileSync(path.join(root, 'debug.log'), 'files are never ignored by .gitignore alone');
    fs.writeFileSync(path.join(root, 'lib/a.ts'), 'export const a = 2;\n');
    await waitFor(() => events.some((e) => e.rel === 'lib/a.ts') && events.some((e) => e.rel === 'debug.log'));
    await sleep(300);
    expect(events.filter((e) => e.rel.startsWith('tmp'))).toEqual([]);
  });

  it('reports a removed folder', async () => {
    const root = tmpProject({ 'lib/a.ts': '', 'lib/b.ts': '', 'app/page.tsx': '' });
    const events: WatchEvent[] = [];
    watcher = await watchProject(root, (e) => events.push(e));
    fs.rmSync(path.join(root, 'lib'), { recursive: true });
    await waitFor(() => events.some((e) => (e.kind === 'dir-removed' && e.rel === 'lib') || e.rel === 'lib/a.ts'));
  });
});
