import { describe, expect, it } from 'vitest';
import { isStale, parseFrame } from './connection';

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
