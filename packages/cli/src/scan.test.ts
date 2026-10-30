import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runScan } from './scan';

const fixture = (name: string) => fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

describe('runScan', () => {
  it('prints a Swedish summary', () => {
    let out = '';
    expect(runScan([fixture('clean-app'), '--lang', 'sv'], (s) => (out += s))).toBe(0);
    expect(out).toContain('Mapskill · clean-app (nextjs)');
    expect(out).toContain('Sidor: 2');
    expect(out).toContain('Fynd: 0 säkra');
  });

  it('prints findings with certainty in English', () => {
    let out = '';
    runScan([fixture('messy-app')], (s) => (out += s));
    expect(out).toMatch(/Findings: \d+ certain, \d+ likely/);
    expect(out).toContain('[certain] Same code with different names');
  });

  it('prints JSON without per-file facts', () => {
    let out = '';
    runScan([fixture('clean-app'), '--json'], (s) => (out += s));
    const parsed = JSON.parse(out) as { nodes: unknown[]; files?: unknown; fileCount: number };
    expect(parsed.nodes.length).toBeGreaterThan(0);
    expect(parsed.files).toBeUndefined();
    expect(parsed.fileCount).toBe(6);
  });
});
