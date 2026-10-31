// packages/cli/src/hooks/user-prompt-submit.ts
import type { MapRequest } from '@mapskill/core';
import { ensureDaemon, request } from '../daemon/client';
import { logHookProblem } from './log';
import { ALLOW, timeLeft, type HookHandler } from './types';

export function formatRequests(requests: MapRequest[]): string {
  return [
    'The user sent these requests from the Mapskill map. Handle them as part of this turn, in order:',
    ...requests.map((r, i) => `${i + 1}. ${r.text.replace(/\r?\n/g, '\n   ')}`),
  ].join('\n');
}

/**
 * Marks the start of a turn, so the Stop hook knows which findings are new, and hands requests queued on the map to
 * Claude. Restarts an idle-stopped daemon.
 */
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
  const sessionId = input.session_id ?? 'default';
  await request(info, 'POST', '/api/turn', { sessionId }, t);
  const left = timeLeft(ctx);
  if (left < 200) {
    logHookProblem(root, 'user-prompt-submit', 'skipped claiming map requests: no time left');
    return ALLOW;
  }
  const { requests } = await request<{ requests: MapRequest[] }>(info, 'POST', '/api/requests/claim', { sessionId }, left);
  if (requests.length === 0) return ALLOW;
  return {
    exitCode: 0,
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: formatRequests(requests) } }),
  };
};
