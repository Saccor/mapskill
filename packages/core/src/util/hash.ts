import { createHash } from 'node:crypto';

export function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
