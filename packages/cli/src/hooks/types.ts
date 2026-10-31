// packages/cli/src/hooks/types.ts
import type { HookInput } from './input';

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

export const ALLOW: HookResult = { exitCode: 0 };

/** Milliseconds of this hook's budget still free, minus a margin for answering. Never negative. */
export function timeLeft(ctx: HookContext, marginMs = 300): number {
  return Math.max(0, ctx.deadline - Date.now() - marginMs);
}
