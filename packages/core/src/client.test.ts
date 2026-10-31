import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as client from './client';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/** Relative imports of a module, followed recursively; fails on typescript or node: imports. */
function walk(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/^(?:import|export)\s+(type\s+)?[^'"]*from\s+'([^']+)'/gm)) {
    const typeOnly = Boolean(m[1]);
    const spec = m[2];
    if (typeOnly) continue;
    if (spec === 'typescript' || spec.startsWith('node:')) throw new Error(`${file} imports ${spec}`);
    if (spec.startsWith('.')) walk(path.resolve(path.dirname(file), `${spec}.ts`), seen);
  }
  return seen;
}

describe('@mapskill/core/client', () => {
  it('exports what the map view needs', () => {
    expect(typeof client.applyDelta).toBe('function');
    expect(client.ZONE_LABELS.pages.sv).toBe('Sidor');
  });

  it('never reaches the TypeScript compiler or node: modules', () => {
    expect(() => walk(path.join(here, 'client.ts'))).not.toThrow();
  });
});
