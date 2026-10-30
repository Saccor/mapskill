import type { FileLink } from '../model/types';

export function findCycles(links: FileLink[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const l of links) {
    if (l.typeOnly) continue;
    adjacency.set(l.from, [...(adjacency.get(l.from) ?? []), l.to]);
  }
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];

  const strongConnect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) out.push(component.sort());
    }
  };

  for (const v of adjacency.keys()) if (!index.has(v)) strongConnect(v);
  return out;
}
