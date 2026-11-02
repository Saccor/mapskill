import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRelease } from './release';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-release-guard-'));

// The slow full build is in release.release.test.ts; these refuse before anything is bundled or deleted.
describe('buildRelease guards', () => {
  it('refuses to delete a folder that is not named release', async () => {
    const dir = path.join(tmp(), 'important');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'mine');
    await expect(buildRelease(dir)).rejects.toThrow(/Refusing to delete/);
    expect(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8')).toBe('mine');
  });

  it('refuses to delete a release folder that holds no earlier build', async () => {
    const dir = path.join(tmp(), 'release');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'mine');
    await expect(buildRelease(dir)).rejects.toThrow(/Refusing to delete/);
    expect(fs.existsSync(path.join(dir, 'keep.txt'))).toBe(true);
  });

  it('says clearly when plugin/README.en.md is missing', async () => {
    const pluginDir = tmp();
    await expect(buildRelease(path.join(tmp(), 'release'), { pluginDir })).rejects.toThrow(/README\.en\.md is missing/);
  });
});
