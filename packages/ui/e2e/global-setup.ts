import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../..');

/** Runs the CLI from source the way the daemon spawner does in development (node + tsx loader + bin.ts). */
export function cli(args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const loader = createRequire(path.join(repo, 'packages/cli/package.json')).resolve('tsx');
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, path.join(repo, 'packages/cli/src/bin.ts'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export default function globalSetup(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-pw-'));
  fs.cpSync(path.join(repo, 'fixtures', 'clean-app'), root, { recursive: true, filter: (src) => !src.split(path.sep).includes('.mapskill') });
  const r = cli(['open', root, '--no-browser'], { MAPSKILL_UI_DIR: path.join(repo, 'packages', 'ui', 'dist') });
  const url = /Mapskill map: (\S+)/.exec(r.stdout)?.[1];
  if (r.status !== 0 || !url) throw new Error(`could not start Mapskill: ${r.stdout} ${r.stderr}`);
  process.env.MAPSKILL_E2E_URL = url;
  process.env.MAPSKILL_E2E_ROOT = root;
}
