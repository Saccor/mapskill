import { describe, expect, it } from 'vitest';
import { isStale, parseFrame, seenThrottle } from './connection';

describe('parseFrame', () => {
  it('returns the message for a good frame and null for anything else', () => {
    expect(parseFrame('{"type":"turn","sessionId":"s"}')).toEqual({ type: 'turn', sessionId: 's' });
    expect(parseFrame('{ nope')).toBeNull();
    expect(parseFrame('42')).toBeNull();
    expect(parseFrame('null')).toBeNull();
    expect(parseFrame('{"no":"type"}')).toBeNull();
  });
});

describe('isStale', () => {
  it('is true after five failed reconnects in a row', () => {
    expect(isStale(4)).toBe(false);
    expect(isStale(5)).toBe(true);
  });
});

describe('seenThrottle', () => {
  it('lets one seen message through per minute', () => {
    const allow = seenThrottle();
    expect(allow(1_000)).toBe(true);
    expect(allow(2_000)).toBe(false);
    expect(allow(60_999)).toBe(false);
    expect(allow(61_000)).toBe(true);
    expect(allow(61_001)).toBe(false);
  });

  it('takes its own gap', () => {
    const allow = seenThrottle(10);
    expect(allow(0)).toBe(true);
    expect(allow(10)).toBe(true);
  });
});
