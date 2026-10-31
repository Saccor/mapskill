// packages/cli/src/hooks/user-prompt-submit.ts
import { ensureDaemon, request } from '../daemon/client';
import { ALLOW, type HookHandler } from './run';

/** Marks the start of a turn, so the Stop hook knows which findings are new. Restarts an idle-stopped daemon. */
export const userPromptSubmit: HookHandler = async ({ input, root, jsProject }) => {
  if (!jsProject) return ALLOW;
  const info = await ensureDaemon(root, { timeoutMs: 2000 });
  if (!info) return ALLOW;
  await request(info, 'POST', '/api/turn', { sessionId: input.session_id ?? 'default' }, 3000);
  return ALLOW;
};
