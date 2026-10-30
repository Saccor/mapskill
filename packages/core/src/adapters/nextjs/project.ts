import fs from 'node:fs';
import path from 'node:path';

export function isNextProject(root: string): boolean {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.next ?? pkg.devDependencies?.next);
  } catch {
    return false;
  }
}

export function readPrismaModels(root: string): string[] {
  const file = path.join(root, 'prisma', 'schema.prisma');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1].charAt(0).toLowerCase() + m[1].slice(1));
}
