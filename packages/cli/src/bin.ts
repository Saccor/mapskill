#!/usr/bin/env node
import { runScan } from './scan';

const [command, ...rest] = process.argv.slice(2);
if (command === 'scan') {
  process.exit(runScan(rest));
}
process.stderr.write('Usage: mapskill scan [dir] [--json] [--lang en|sv]\n');
process.exit(1);
