// The handler modules must work when one of them is loaded before run.ts.
import path from 'node:path';
import { Readable } from 'node:stream';
import { tmpProject } from '@mapskill/core/test-helpers';
import { expect, it } from 'vitest';
import { addLocks } from '../locks';
import { canonicalRoot } from '../project-path';
import { preToolUse } from './pre-tool-use';
import { runHook } from './run';

it('runHook still finds the built-in handlers when a handler module was imported first', async () => {
  expect(typeof preToolUse).toBe('function');
  const root = canonicalRoot(tmpProject({ 'package.json': '{}', 'lib/a.ts': '' }));
  addLocks(root, [path.join(root, 'lib', 'a.ts')]);
  const input = { cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'lib', 'a.ts') } };
  const r = await runHook('pre-tool-use', { stdin: Readable.from([JSON.stringify(input)]), env: { CLAUDE_PROJECT_DIR: root } });
  expect(r.exitCode).toBe(2);
});
