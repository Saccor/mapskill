import { type Store, useStore } from '@/lib/store';

export function Counter({ store }: { store?: Store }) {
  return <span>{store ? store.items.length : useStore()}</span>;
}
