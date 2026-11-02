/** Every command the CLI accepts. No side effects: tests import this without running the CLI. */
export const COMMAND_NAMES = [
  '--help',
  '-h',
  '--version',
  '-v',
  'stats',
  'scan',
  'status',
  'stop',
  'open',
  'daemon',
  'lock',
  'unlock',
  'locks',
  'mcp',
  'hook',
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];
