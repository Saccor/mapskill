// Tests must never write the real ~/.mapskill/usage.jsonl.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

process.env.MAPSKILL_HOME ||= fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-home-'));

// A test that passes its own env without MAPSKILL_HOME would reach the real log: fail the file when that happens.
const realUsageFile = path.join(os.homedir(), '.mapskill', 'usage.jsonl');
const stamp = (): string => {
  try {
    const s = fs.statSync(realUsageFile);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return 'none';
  }
};
const before = stamp();
afterAll(() => {
  if (stamp() !== before) throw new Error(`a test wrote the real usage log ${realUsageFile}`);
});
