import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateProject } from '../test-helpers';
import { applyFileChanges, loadProject } from './project';

describe('performance', () => {
  it('updates a 500-file project after a one-file edit within 1.5 seconds', () => {
    const root = generateProject(500);
    const project = loadProject(root);
    expect(Object.keys(project.facts)).toHaveLength(500);
    fs.appendFileSync(path.join(root, 'lib/h7.ts'), '\nexport const extra = 1;\n');
    const started = performance.now();
    const result = applyFileChanges(project, ['lib/h7.ts']);
    const ms = performance.now() - started;
    expect(result.empty).toBe(false);
    expect(ms).toBeLessThan(1500);
  }, 60_000);
});
