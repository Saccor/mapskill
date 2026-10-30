export const db = {
  post: { findMany: async () => [] as string[] },
  comment: { findMany: async () => [] as string[] },
};

export function fmt(a: string): string;
export function fmt(a: number): string;
export function fmt(a: string | number) {
  return String(a);
}
