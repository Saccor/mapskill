// packages/cli/src/hooks/session-start.ts
import { ensureDaemon } from '../daemon/client';
import { mapUrl } from '../open-command';
import { readLocks, type Lock } from '../locks';
import { ALLOW, timeLeft, type HookHandler } from './types';

export function sessionContext(info: { port: number; token: string } | null, locks: Lock[] | null): string {
  const lines = [
    info
      ? 'Mapskill is mapping this project. Before you add a function, component or file, call the Mapskill find_similar tool and reuse what fits; call map_overview to see where things belong.'
      : 'Mapskill could not start its background process; its tools may answer slowly or not at all. Locks still apply.',
  ];
  if (info) lines.push(`Mapskill map for the user (open it in a browser): ${mapUrl(info)}`);
  if (locks === null) lines.push('Mapskill cannot read .mapskill/locks.json; ask the user before changing files they may have locked.');
  else if (locks.length > 0) {
    lines.push(`Locked by the user (do not change without asking): ${locks.map((l) => (l.label ? `${l.path} (${l.label})` : l.path)).join(', ')}`);
  }
  return lines.join('\n');
}

/** Starts the daemon and tells Claude that Mapskill is there and what is locked. */
export const sessionStart: HookHandler = async (ctx) => {
  const { root, jsProject } = ctx;
  if (!jsProject) return ALLOW;
  const info = await ensureDaemon(root, { timeoutMs: Math.max(0, Math.min(3000, timeLeft(ctx) - 1500)) });
  const read = readLocks(root);
  const additionalContext = sessionContext(info, read.ok ? read.locks : null);
  return { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }) };
};
