import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../..');

/** Runs the CLI from source the way the daemon spawner does in development (node + tsx loader + bin.ts). */
export function cli(args: string[], env: NodeJS.ProcessEnv = {}, input?: string): { status: number | null; stdout: string; stderr: string } {
  // Set on process.env (not only the child's env), so the teardown, the workers and every spawned daemon share one temp home.
  process.env.MAPSKILL_HOME ||= fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-home-'));
  const loader = createRequire(path.join(repo, 'packages/cli/package.json')).resolve('tsx');
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, path.join(repo, 'packages/cli/src/bin.ts'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
    input,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Starts a daemon on its own temp copy of a fixture (without .mapskill/); stop() stops it and removes the copy. */
export function startCopy(fixtureName: string): { root: string; url: string; stop(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mapskill-pw-${fixtureName}-`));
  fs.cpSync(path.join(repo, 'fixtures', fixtureName), root, { recursive: true, filter: (src) => !src.split(path.sep).includes('.mapskill') });
  const r = cli(['open', root, '--no-browser'], { MAPSKILL_UI_DIR: path.join(repo, 'packages', 'ui', 'dist') });
  const url = /Mapskill map: (\S+)/.exec(r.stdout)?.[1];
  if (r.status !== 0 || !url) {
    cli(['stop', root]);
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(`could not start Mapskill: ${r.stdout} ${r.stderr}`);
  }
  return {
    root,
    url,
    stop() {
      cli(['stop', root]);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The developer's real usage log, which e2e must never touch. */
export const realUsageFile = path.join(os.homedir(), '.mapskill', 'usage.jsonl');

/** Size and time of the real usage log, or 'none'. Compared in teardown. */
export function realUsageStamp(): string {
  try {
    const s = fs.statSync(realUsageFile);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return 'none';
  }
}

export default function globalSetup(): void {
  process.env.MAPSKILL_E2E_USAGE_STAMP = realUsageStamp();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-pw-'));
  fs.cpSync(path.join(repo, 'fixtures', 'clean-app'), root, { recursive: true, filter: (src) => !src.split(path.sep).includes('.mapskill') });
  const r = cli(['open', root, '--no-browser'], { MAPSKILL_UI_DIR: path.join(repo, 'packages', 'ui', 'dist') });
  const url = /Mapskill map: (\S+)/.exec(r.stdout)?.[1];
  if (r.status !== 0 || !url) throw new Error(`could not start Mapskill: ${r.stdout} ${r.stderr}`);
  process.env.MAPSKILL_E2E_URL = url;
  process.env.MAPSKILL_E2E_ROOT = root;
}
