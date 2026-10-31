// packages/cli/src/hooks/run.ts
import { hookRoot, isJsProject, readHookInput, type HookInput } from './input';
import { logHookProblem } from './log';
import { postToolUse } from './post-tool-use';
import { preToolUse } from './pre-tool-use';
import { sessionStart } from './session-start';
import { stop } from './stop';
import { userPromptSubmit } from './user-prompt-submit';

export interface HookResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface HookContext {
  input: HookInput;
  root: string;
  jsProject: boolean;
  env: NodeJS.ProcessEnv;
  /** Absolute epoch ms by which the hook's work must be done. Counts from before stdin is read. */
  deadline: number;
}

export type HookHandler = (ctx: HookContext) => Promise<HookResult>;

export const HOOK_EVENTS = ['session-start', 'user-prompt-submit', 'pre-tool-use', 'post-tool-use', 'stop'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export const ALLOW: HookResult = { exitCode: 0 };

/** Inner deadlines, below the timeouts in plugin/hooks/hooks.json. */
const DEADLINE_MS: Record<HookEvent, number> = {
  'session-start': 9000,
  'user-prompt-submit': 4000,
  'pre-tool-use': 4000,
  'post-tool-use': 4000,
  stop: 12_000,
};

/** Milliseconds of this hook's budget still free, minus a margin for answering. Never negative. */
export function timeLeft(ctx: HookContext, marginMs = 300): number {
  return Math.max(0, ctx.deadline - Date.now() - marginMs);
}

const isEvent = (e: string): e is HookEvent => (HOOK_EVENTS as readonly string[]).includes(e);

const builtIn: Partial<Record<HookEvent, HookHandler>> = {
  'session-start': sessionStart,
  'user-prompt-submit': userPromptSubmit,
  'pre-tool-use': preToolUse,
  'post-tool-use': postToolUse,
  stop,
};

/**
 * Runs one hook. Never throws. Everything except a lock decision is fail-open: an error or a timeout lets Claude
 * continue and leaves a line in .mapskill/log.txt.
 */
export async function runHook(
  event: string,
  io: { stdin: NodeJS.ReadableStream; env: NodeJS.ProcessEnv },
  handlers: Partial<Record<HookEvent, HookHandler>> = builtIn,
): Promise<HookResult> {
  if (!isEvent(event)) return { exitCode: 1, stderr: `Unknown hook event: ${event}. Expected one of ${HOOK_EVENTS.join(', ')}.\n` };
  const handler = handlers[event];
  const deadline = Date.now() + DEADLINE_MS[event];
  const input = await readHookInput(io.stdin, { timeoutMs: Math.min(2000, DEADLINE_MS[event] / 4) });
  const root = hookRoot(input, io.env);
  if (!handler) return ALLOW;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol('timeout');
  try {
    const result = await Promise.race([
      handler({ input, root, jsProject: isJsProject(root), env: io.env, deadline }),
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), Math.max(0, deadline - Date.now()));
      }),
    ]);
    if (result === timedOut) {
      logHookProblem(root, event, 'timed out');
      return ALLOW;
    }
    return result;
  } catch (err) {
    logHookProblem(root, event, err);
    return ALLOW;
  } finally {
    clearTimeout(timer);
  }
}
