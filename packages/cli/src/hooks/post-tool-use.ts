// packages/cli/src/hooks/post-tool-use.ts
import { liveDaemon, request } from '../daemon/client';
import { editedFile } from './input';
import { logHookProblem } from './log';
import { ALLOW, timeLeft, type HookHandler } from './types';

/** Tells the daemon which file Claude just changed (or that a Bash command may have changed files). */
export const postToolUse: HookHandler = async (ctx) => {
  const { input, root, jsProject } = ctx;
  if (!jsProject) return ALLOW;
  const bash = input.tool_name === 'Bash';
  const file = bash ? undefined : editedFile(input);
  if (!bash && !file) return ALLOW;
  const info = await liveDaemon(root);
  if (!info) return ALLOW;
  const t = timeLeft(ctx);
  if (t < 200) {
    logHookProblem(root, 'post-tool-use', 'skipped: no time left');
    return ALLOW;
  }
  await request(
    info,
    'POST',
    '/api/touched',
    {
      files: file ? [file] : [],
      sessionId: input.session_id ?? 'default',
      ...(input.tool_use_id ? { toolUseId: input.tool_use_id } : {}),
      ...(bash ? { bash: true } : {}),
    },
    t,
  );
  return ALLOW;
};
