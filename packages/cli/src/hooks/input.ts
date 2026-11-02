// packages/cli/src/hooks/input.ts
import fs from 'node:fs';
import path from 'node:path';
import { canonicalRoot } from '../project-path';
import { isUnsafeRoot } from '../unsafe-root';

// Hooks must stay light: no runtime import of @mapskill/core anywhere under hooks/ (it loads the TypeScript compiler).

/** The fields Mapskill reads from Claude Code's hook input. All optional: hooks must survive any shape. */
export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  stop_hook_active?: boolean;
}

/** Reads the hook's JSON from stdin. Garbage, too much input or a stalled pipe give `{}`. */
export async function readHookInput(
  stream: NodeJS.ReadableStream,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<HookInput> {
  const maxBytes = options.maxBytes ?? 1_000_000;
  const read = (async () => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
      size += buf.length;
      if (size > maxBytes) return '';
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
  })();
  read.catch(() => {}); // when the timeout wins, a later stream error must not become an unhandled rejection
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(''), options.timeoutMs ?? 2000);
  });
  const text = await Promise.race([read, timeout]).catch(() => '');
  clearTimeout(timer);
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as HookInput) : {};
  } catch {
    return {};
  }
}

/** The project root: CLAUDE_PROJECT_DIR, else the session's cwd, else this process's cwd. */
export function hookRoot(input: HookInput, env: NodeJS.ProcessEnv): string {
  const dir = env.CLAUDE_PROJECT_DIR || (typeof input.cwd === 'string' && input.cwd) || process.cwd();
  return canonicalRoot(dir);
}

/** True when Mapskill should map this folder: it has a package.json or a tsconfig.json and is not the home folder or a disk root. */
export function isJsProject(root: string, home?: string): boolean {
  if (isUnsafeRoot(root, home)) return false;
  return fs.existsSync(path.join(root, 'package.json')) || fs.existsSync(path.join(root, 'tsconfig.json'));
}

/** The file an edit tool is about to change or just changed, if the tool input names one. */
export function editedFile(input: HookInput): string | undefined {
  const ti = input.tool_input ?? {};
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const v = ti[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}
