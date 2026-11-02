// Tests must never write the real ~/.mapskill/usage.jsonl.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MAPSKILL_HOME ||= fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-home-'));
