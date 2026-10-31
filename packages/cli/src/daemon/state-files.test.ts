import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { MAX_LAYOUT_ENTRIES, mergeLayout, readDismissed, readLayout, writeDismissed, writeLayout } from './state-files';

describe('state files', () => {
  it('round-trips dismissed findings and layout', () => {
    const r = tmpProject({ 'package.json': '{}' });
    expect(readDismissed(r)).toEqual({});
    expect(readLayout(r)).toEqual({ version: 1, slots: {} });
    writeDismissed(r, { 'exact-duplicate:abc': 'hash1' });
    writeLayout(r, { version: 1, slots: { 'page:app/page.tsx': 0, 'helper:lib/a.ts#a': 3 } });
    expect(readDismissed(r)).toEqual({ 'exact-duplicate:abc': 'hash1' });
    expect(readLayout(r).slots).toEqual({ 'page:app/page.tsx': 0, 'helper:lib/a.ts#a': 3 });
  });

  it('drops invalid entries', () => {
    const r = tmpProject({ 'package.json': '{}' });
    fs.mkdirSync(path.join(r, '.mapskill'), { recursive: true });
    fs.writeFileSync(path.join(r, '.mapskill', 'layout.json'), JSON.stringify({ version: 1, slots: { a: 1, b: -1, c: 1.5, d: 'x' } }));
    fs.writeFileSync(path.join(r, '.mapskill', 'dismissed.json'), JSON.stringify({ dismissed: { a: 'h', b: 3 } }));
    expect(readLayout(r).slots).toEqual({ a: 1 });
    expect(readDismissed(r)).toEqual({ a: 'h' });
  });

  it('merges a save into the stored layout and drops the oldest entries over the cap', () => {
    expect(mergeLayout({ a: 1, gone: 2 }, { a: 5, b: 3 })).toEqual({ a: 5, gone: 2, b: 3 });
    expect(MAX_LAYOUT_ENTRIES).toBe(10_000);
    expect(mergeLayout({ constructor: 1 }, { toString: 2 })).toEqual({ constructor: 1, toString: 2 });
    expect(mergeLayout({}, { a: 1 })).toEqual({ a: 1 });
    const existing = Object.fromEntries(Array.from({ length: MAX_LAYOUT_ENTRIES }, (_, i) => [`old${i}`, i]));
    const out = mergeLayout(existing, { fresh1: 0, old5: 9, fresh2: 1 });
    const keys = Object.keys(out);
    expect(keys).toHaveLength(MAX_LAYOUT_ENTRIES);
    expect(keys.slice(-3)).toEqual(['fresh1', 'old5', 'fresh2']);
    expect(out.old5).toBe(9);
    expect('old0' in out).toBe(false);
    expect('old1' in out).toBe(false);
    expect('old2' in out).toBe(true);
  });
});
