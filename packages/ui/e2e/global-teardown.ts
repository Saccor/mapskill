import fs from 'node:fs';
import { cli, realUsageFile, realUsageStamp } from './global-setup';

export default function globalTeardown(): void {
  const root = process.env.MAPSKILL_E2E_ROOT;
  if (root) {
    cli(['stop', root]);
    fs.rmSync(root, { recursive: true, force: true });
  }
  // Tests must never write the developer's real usage log.
  if (realUsageStamp() !== process.env.MAPSKILL_E2E_USAGE_STAMP) throw new Error(`e2e wrote the real usage log ${realUsageFile}`);
}
