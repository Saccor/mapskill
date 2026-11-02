import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProject } from '@mapskill/core/test-helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readDaemonInfo } from '../daemon/info';
import { connect, waitFor } from '../test-utils';
import { buildRelease } from './release';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const SCAN_LIMIT_MS = 20_000;
const DELTA_LIMIT_MS = 2_000;

let tmp: string;
let entry: string;
let project: string;

const cli = (...args: string[]) => spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-perf-'));
  // Use the package that `pnpm build:release` made; build a private copy only when it is missing.
  let packageDir = path.join(repoRoot, 'release', 'mapskill');
  if (!fs.existsSync(path.join(packageDir, 'dist', 'mapskill.mjs'))) ({ packageDir } = await buildRelease(path.join(tmp, 'release')));
  entry = path.join(packageDir, 'dist', 'mapskill.mjs');
  const generated = generateProject(500);
  project = fs.realpathSync(generated);
});

afterAll(() => {
  try {
    if (project && entry) cli('stop', project);
  } finally {
    for (const dir of [tmp, project]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('packaged CLI on 500 generated files', () => {
  it('scans in under 20 seconds', () => {
    const started = Date.now();
    const r = cli('scan', project, '--json');
    const ms = Date.now() - started;
    console.log(`perf: scan of 500 files took ${ms} ms (limit ${SCAN_LIMIT_MS} ms)`);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).findings).toBeInstanceOf(Array);
    expect(ms).toBeLessThan(SCAN_LIMIT_MS);
  });

  it('pushes a delta within 2 seconds of a file change', async () => {
    const open = cli('open', project, '--no-browser');
    expect(open.status, open.stderr).toBe(0);
    const info = readDaemonInfo(project);
    expect(info, 'daemon.json').not.toBeNull();

    const client = await connect(info!);
    try {
      const file = path.join(project, 'lib', 'h0.ts');
      const started = Date.now();
      fs.appendFileSync(file, '\nexport const perfTouch = 1;\n');
      await waitFor(() => client.messages.some((m) => m.type === 'delta'), 10_000, 10);
      const ms = Date.now() - started;
      console.log(`perf: delta arrived ${ms} ms after the change (limit ${DELTA_LIMIT_MS} ms)`);
      expect(ms).toBeLessThan(DELTA_LIMIT_MS);
    } finally {
      client.close();
    }
  });
});
