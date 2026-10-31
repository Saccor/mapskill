// packages/cli/src/hooks/stop.ts
import type { StopAnswer } from '@mapskill/core';
import { liveDaemon, request } from '../daemon/client';
import { logHookProblem } from './log';
import { ALLOW, timeLeft, type HookHandler } from './types';

export function formatStopReason(answer: StopAnswer): string {
  const n = answer.total;
  const lines = [`Mapskill found ${n} new problem${n === 1 ? '' : 's'} in files you changed this turn:`];
  answer.findings.forEach((f, i) => lines.push(`${i + 1}. ${f.message.en}`, `   What to do: ${f.instruction}`));
  const hidden = n - answer.findings.length;
  if (hidden > 0) lines.push(`(${hidden} more not shown; the Mapskill turn_findings tool lists them.)`);
  lines.push('Fix the ones you agree with. For any you leave as they are, tell the user in one plain sentence why.');
  return lines.join('\n');
}

/** Before Claude ends its turn: block once with the new certain findings in the files Claude changed. */
export const stop: HookHandler = async (ctx) => {
  const { input, root, jsProject } = ctx;
  if (input.stop_hook_active === true || !jsProject) return ALLOW;
  const info = await liveDaemon(root);
  if (!info) return ALLOW;
  const t = Math.min(8000, timeLeft(ctx));
  if (t < 200) {
    logHookProblem(root, 'stop', 'skipped: no time left');
    return ALLOW;
  }
  const answer = await request<StopAnswer>(info, 'POST', '/api/stop', { sessionId: input.session_id ?? 'default' }, t);
  if (answer.findings.length === 0) return ALLOW;
  return { exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason: formatStopReason(answer) }) };
};
