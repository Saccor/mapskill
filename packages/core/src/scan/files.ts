import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.mapskill', 'dist', 'build', 'out', 'coverage', '.vercel', '.turbo']);
const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;

export function listSourceFiles(root: string): string[] {
  const ig = ignore();
  const gitignore = path.join(root, '.gitignore');
  if (fs.existsSync(gitignore)) ig.add(fs.readFileSync(gitignore, 'utf8'));
  const out: string[] = [];
  const walk = (dirRel: string): void => {
    for (const entry of fs.readdirSync(path.join(root, dirRel), { withFileTypes: true })) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || ig.ignores(`${rel}/`)) continue;
        walk(rel);
      } else if (entry.isFile() && CODE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts') && !ig.ignores(rel)) {
        out.push(rel);
      }
    }
  };
  walk('');
  return out.sort();
}
