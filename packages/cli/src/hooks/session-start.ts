// packages/cli/src/hooks/session-start.ts
import { ensureDaemon } from '../daemon/client';
import { readLocks, type Lock } from '../locks';
import { ALLOW, type HookHandler } from './run';

export function sessionContext(running: boolean, locks: Lock[] | null): string {
  const lines = [
    running
      ? 'Mapskill is mapping this project. Before you add a function, component or file, call the Mapskill find_similar tool and reuse what fits; call map_overview to see where things belong.'
      : 'Mapskill could not start its background process; its tools may answer slowly or not at all. Locks still apply.',
  ];
  if (locks === null) lines.push('Mapskill cannot read .mapskill/locks.json; ask the user before changing files they may have locked.');
  else if (locks.length > 0) {
    lines.push(`Locked by the user (do not change without asking): ${locks.map((l) => (l.label ? `${l.path} (${l.label})` : l.path)).join(', ')}`);
  }
  return lines.join('\n');
}

/** Starts the daemon and tells Claude that Mapskill is there and what is locked. */
export const sessionStart: HookHandler = async ({ root, jsProject }) => {
  if (!jsProject) return ALLOW;
  const info = await ensureDaemon(root, { timeoutMs: 3000 });
  const read = readLocks(root);
  const additionalContext = sessionContext(info !== null, read.ok ? read.locks : null);
  return { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }) };
};
