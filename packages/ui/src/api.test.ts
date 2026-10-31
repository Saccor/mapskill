import { describe, expect, it } from 'vitest';
import { takeToken } from './api';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('takeToken', () => {
  it('takes the token from the address, saves it and cleans the address', () => {
    const s = store();
    expect(takeToken({ search: '?t=abc&x=1', pathname: '/', hash: '' }, s)).toEqual({ token: 'abc', cleanUrl: '/?x=1' });
    expect(takeToken({ search: '', pathname: '/', hash: '#n' }, s)).toEqual({ token: 'abc', cleanUrl: null });
  });

  it('returns null without a token anywhere', () => {
    expect(takeToken({ search: '', pathname: '/', hash: '' }, store())).toEqual({ token: null, cleanUrl: null });
  });
});
