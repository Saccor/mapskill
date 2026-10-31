// packages/cli/src/hooks/subprocess.test.ts
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { selfCommand } from '../daemon/client';
import { addLocks } from '../locks';
import { canonicalRoot } from '../project-path';

function hook(event: string, input: unknown, env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const { command, args } = selfCommand();
  const r = spawnSync(command, [...args, 'hook', event], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env },
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('mapskill hook (subprocess)', () => {
  it('blocks a locked file with exit code 2 and allows others with 0', () => {
    const root = canonicalRoot(tmpProject({ 'package.json': '{}', 'lib/a.ts': '', 'lib/b.ts': '' }));
    addLocks(root, [path.join(root, 'lib', 'a.ts')]);
    const input = (rel: string) => ({ session_id: 's', cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, rel) } });
    const blocked = hook('pre-tool-use', input('lib/a.ts'));
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('lib/a.ts');
    expect(hook('pre-tool-use', input('lib/b.ts')).status).toBe(0);
  }, 60_000);

  it('rejects an unknown event', () => {
    expect(hook('nope', {}).status).toBe(1);
  }, 30_000);
});
