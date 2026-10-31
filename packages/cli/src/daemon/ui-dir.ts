// packages/cli/src/daemon/ui-dir.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSelfEntry } from './client';

/** Where the built map view lives: MAPSKILL_UI_DIR, next to the bundle (ui/), or packages/ui/dist in the repo. */
export function findUiDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const entry = getSelfEntry();
  const candidates = [
    env.MAPSKILL_UI_DIR,
    entry ? path.join(path.dirname(entry), 'ui') : undefined,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ui/dist'),
  ];
  for (const dir of candidates) if (dir && fs.existsSync(path.join(dir, 'index.html'))) return dir;
  return null;
}
