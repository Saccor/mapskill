import { fileURLToPath } from 'node:url';

export function fixture(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
}
