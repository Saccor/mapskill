import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';

const SKIP_ANYWHERE = new Set(['node_modules', '.next', '.git', '.mapskill', '.vercel', '.turbo', 'coverage']);
const SKIP_AT_ROOT = new Set(['dist', 'build', 'out', 'public']);
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
        if (SKIP_ANYWHERE.has(entry.name) || (!dirRel && SKIP_AT_ROOT.has(entry.name)) || ig.ignores(`${rel}/`)) continue;
        walk(rel);
      } else if (entry.isFile() && CODE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts') && !ig.ignores(rel)) {
        out.push(rel);
      }
    }
  };
  walk('');
  return out.sort();
}
