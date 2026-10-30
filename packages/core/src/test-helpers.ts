import { fileURLToPath } from 'node:url';

export function fixture(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Writes a throwaway project to a temp dir and returns its root. */
export function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-proj-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
