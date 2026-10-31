// packages/cli/src/hooks/user-prompt-submit.ts
import { ensureDaemon, request } from '../daemon/client';
import { logHookProblem } from './log';
import { ALLOW, timeLeft, type HookHandler } from './types';

/** Marks the start of a turn, so the Stop hook knows which findings are new. Restarts an idle-stopped daemon. */
export const userPromptSubmit: HookHandler = async (ctx) => {
  const { input, root, jsProject } = ctx;
  if (!jsProject) return ALLOW;
  const info = await ensureDaemon(root, { timeoutMs: Math.min(2000, timeLeft(ctx) / 2) });
  if (!info) return ALLOW;
  const t = timeLeft(ctx);
  if (t < 200) {
    logHookProblem(root, 'user-prompt-submit', 'skipped: no time left');
    return ALLOW;
  }
  await request(info, 'POST', '/api/turn', { sessionId: input.session_id ?? 'default' }, t);
  return ALLOW;
};
