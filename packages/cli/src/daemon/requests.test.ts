import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it, vi } from 'vitest';
import { MAX_REQUESTS, RequestQueue } from './requests';

const write = vi.hoisted(() => ({ fail: false }));
vi.mock('./paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./paths')>();
  return {
    ...actual,
    writeJsonAtomic: (...args: Parameters<typeof actual.writeJsonAtomic>) => {
      if (write.fail) throw new Error('disk full');
      return actual.writeJsonAtomic(...args);
    },
  };
});

const root = (): string => tmpProject({ 'package.json': '{}' });

describe('RequestQueue', () => {
  it('adds, persists, claims once and cancels', () => {
    const r = root();
    let t = 1000;
    const q = new RequestQueue(r, () => t++);
    const a = q.add({ kind: 'explain', text: '  Explain /profile  ', nodeId: 'page:app/profile/page.tsx' });
    const b = q.add({ kind: 'fix', text: 'Fix it', findingId: 'x' });
    expect(a.text).toBe('Explain /profile');
    expect(new RequestQueue(r).list().map((x) => x.id)).toEqual([a.id, b.id]);
    expect(q.cancel(b.id)).toBe(true);
    expect(q.cancel(b.id)).toBe(false);
    const claimed = q.claimPending();
    expect(claimed.map((x) => x.id)).toEqual([a.id]);
    expect(q.claimPending()).toEqual([]);
    const reread = new RequestQueue(r).list();
    expect(reread.find((x) => x.id === a.id)).toMatchObject({ status: 'sent' });
    expect(reread.find((x) => x.id === b.id)).toMatchObject({ status: 'cancelled' });
  });

  it('rejects empty and too long text', () => {
    const q = new RequestQueue(root());
    expect(() => q.add({ kind: 'custom', text: '   ' })).toThrow(RangeError);
    expect(() => q.add({ kind: 'custom', text: 'x'.repeat(2001) })).toThrow(RangeError);
  });

  it('prunes old sent and cancelled requests first and never pending ones', () => {
    const q = new RequestQueue(root());
    const first = q.add({ kind: 'custom', text: 'keep me pending' });
    for (let i = 0; i < MAX_REQUESTS; i++) {
      const x = q.add({ kind: 'custom', text: `r${i}` });
      if (i % 2 === 0) q.cancel(x.id);
    }
    const list = q.list();
    expect(list.length).toBeLessThanOrEqual(MAX_REQUESTS);
    expect(list.some((x) => x.id === first.id)).toBe(true);
  });

  it('starts empty on a broken file', () => {
    const r = root();
    fs.mkdirSync(path.join(r, '.mapskill'), { recursive: true });
    fs.writeFileSync(path.join(r, '.mapskill', 'requests.json'), '{ nope');
    expect(new RequestQueue(r).list()).toEqual([]);
  });

  it('leaves memory and file unchanged when a write fails, and passes the error on', () => {
    const r = root();
    const q = new RequestQueue(r);
    const keep = q.add({ kind: 'custom', text: 'keep' });
    const cancelMe = q.add({ kind: 'custom', text: 'cancel me' });
    write.fail = true;
    try {
      expect(() => q.add({ kind: 'custom', text: 'lost' })).toThrow('disk full');
      expect(q.list().map((x) => x.id)).toEqual([keep.id, cancelMe.id]);
      expect(() => q.cancel(cancelMe.id)).toThrow('disk full');
      expect(q.list().every((x) => x.status === 'pending')).toBe(true);
      expect(() => q.claimPending()).toThrow('disk full');
      expect(q.list().every((x) => x.status === 'pending' && x.sentAt === undefined)).toBe(true);
    } finally {
      write.fail = false;
    }
    expect(q.claimPending().map((x) => x.id)).toEqual([keep.id, cancelMe.id]);
    expect(new RequestQueue(r).list().every((x) => x.status === 'sent')).toBe(true);
  });
});
