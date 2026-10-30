import { fileURLToPath } from 'node:url';

export function fixture(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Writes a throwaway project to a temp dir and returns its root. */
export function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-proj-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const OPS = ['+', '-', '*', '%'];

function generatedBody(seed: number, statements: number): string {
  const lines: string[] = [];
  for (let k = 0; k < statements; k++) {
    const v = `v${k}`;
    const prev = k > 0 ? `v${k - 1}` : 'x';
    switch ((seed * 7 + k * 3) % 5) {
      case 0:
        lines.push(`  const ${v} = ${prev} ${OPS[(seed + k) % 4]} ${seed + k};`);
        break;
      case 1:
        lines.push(`  const ${v} = [${prev}, ${k}].map((q) => q ${OPS[k % 4]} 1).length;`);
        break;
      case 2:
        lines.push(`  const ${v} = ${prev} > ${k} ? String(${prev}).length : ${k};`);
        break;
      case 3:
        lines.push(`  let ${v} = 0;`, `  for (let j = 0; j < ${k}; j++) { ${v} += j; }`);
        break;
      default:
        lines.push(`  const ${v} = Math.max(${prev}, ${seed % 11});`);
    }
  }
  return `${lines.join('\n')}\n  return v${statements - 1};`;
}

/** Writes a Next.js project with `fileCount` source files (1/5 pages, the rest split between components and helpers) and returns its root. */
export function generateProject(fileCount: number): string {
  const pages = Math.max(1, Math.floor(fileCount / 5));
  const components = Math.max(1, Math.floor((fileCount - pages) / 2));
  const helpers = Math.max(1, fileCount - pages - components);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['./*'] } } }),
  };
  for (let i = 0; i < pages; i++) {
    const a = (2 * i) % components;
    const b = (2 * i + 1) % components;
    files[`app/p${i}/page.tsx`] =
      `import { C${a} } from '@/components/C${a}';\n` +
      (a === b ? '' : `import { C${b} } from '@/components/C${b}';\n`) +
      `export default function Page() {\n  return <main><C${a} n={${i}} />${a === b ? '' : `<C${b} n={${i}} />`}</main>;\n}\n`;
  }
  for (let i = 0; i < components; i++) {
    const h = i % helpers;
    files[`components/C${i}.tsx`] =
      `import { h${h} } from '@/lib/h${h}';\n` +
      `function calc(x: number) {\n${generatedBody(i, 6 + (i % 9))}\n}\n` +
      `export function C${i}(props: { n: number }) {\n  return <div>{h${h}(calc(props.n))}</div>;\n}\n`;
  }
  for (let i = 0; i < helpers; i++) {
    files[`lib/h${i}.ts`] = `export function h${i}(x: number): number {\n${generatedBody(i + 1000, 8 + (i % 13))}\n}\n`;
  }
  return tmpProject(files);
}
