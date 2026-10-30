import { type B } from './b';

export type A = { b?: B };
export const makeA = (): A => ({});
