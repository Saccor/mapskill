import fs from 'node:fs';
import { cli } from './global-setup';

export default function globalTeardown(): void {
  const root = process.env.MAPSKILL_E2E_ROOT;
  if (!root) return;
  cli(['stop', root]);
  fs.rmSync(root, { recursive: true, force: true });
}
