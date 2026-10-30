import { a } from './cycle-a';

export function b(n: number): number {
  return n <= 0 ? 0 : a(n - 1);
}
