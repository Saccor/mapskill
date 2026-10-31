// packages/cli/src/build/e2e.test.ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from '@mapskill/core/test-helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runStop } from '../commands';
import { readDaemonInfo } from '../daemon/info';
import { addLocks } from '../locks';
import { canonicalRoot } from '../project-path';
import { bundlePlugin, type BundleReport } from './bundle';

let report: BundleReport;
let root: string;
const temps: string[] = [];

beforeAll(async () => {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-e2e-bundle-'));
  temps.push(bundleDir);
  report = await bundlePlugin(bundleDir);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-e2e-'));
  temps.push(dir);
  fs.cpSync(fixture('messy-app'), dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('.mapskill') });
  root = canonicalRoot(dir);
}, 120_000);

afterAll(async () => {
  if (root) await runStop(root, () => {});
  for (const dir of temps) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function hook(event: string, input: Record<string, unknown>) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [report.entry, 'hook', event], {
    input: JSON.stringify({ session_id: 'e2e', cwd: root, hook_event_name: event, ...input }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - started };
}

const duplicate = [
  'export function formatOrderDate(value: string): string {',
  '  const when = new Date(value);',
  '  const y = when.getFullYear();',
  "  const m = String(when.getMonth() + 1).padStart(2, '0');",
  "  const d = String(when.getDate()).padStart(2, '0');",
  '  return `${y}-${m}-${d}`;',
  '}',
  '',
].join('\n');

describe('a Claude turn through the bundled plugin', () => {
  it('starts the daemon, tracks the edit, blocks the stop once, and enforces a lock', () => {
    const start = hook('session-start', { source: 'startup' });
    expect(start.status).toBe(0);
    expect(JSON.parse(start.stdout).hookSpecificOutput.additionalContext).toContain('Mapskill is mapping this project');
    const info = readDaemonInfo(root);
    expect(info).not.toBeNull();
    expect(info!.pid).not.toBe(process.pid);

    expect(hook('user-prompt-submit', { prompt: 'Show order dates as YYYY-MM-DD' }).status).toBe(0);

    const file = path.join(root, 'lib', 'order-date.ts');
    fs.writeFileSync(file, duplicate);
    expect(hook('post-tool-use', { tool_name: 'Write', tool_use_id: 'w1', tool_input: { file_path: file, content: duplicate } }).status).toBe(0);

    const stop = hook('stop', { stop_hook_active: false });
    expect(stop.status).toBe(0);
    const decision = JSON.parse(stop.stdout) as { decision: string; reason: string };
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('lib/order-date.ts');
    expect(decision.reason).toMatch(/formatDate/);

    expect(hook('stop', { stop_hook_active: true }).stdout).toBe('');
    expect(hook('stop', { stop_hook_active: false }).stdout).toBe('');

    addLocks(root, [path.join(root, 'lib', 'date.ts')], 'Datum');
    const blocked = hook('pre-tool-use', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'lib', 'date.ts') } });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('"Datum"');
    const allowed = hook('pre-tool-use', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'lib', 'cart.ts') } });
    expect(allowed.status).toBe(0);
    // The lock check loads no TypeScript compiler; it should be about as fast as starting node.
    expect(allowed.ms).toBeLessThan(2000);
  }, 120_000);
});
