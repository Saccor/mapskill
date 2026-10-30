import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

const SKIP_ANYWHERE = new Set(['node_modules', '.next', '.git', '.mapskill', '.vercel', '.turbo', 'coverage']);
const SKIP_AT_ROOT = new Set(['dist', 'build', 'out', 'public']);
const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;

function loadIgnore(root: string): Ignore {
  const ig = ignore();
  const gitignore = path.join(root, '.gitignore');
  if (fs.existsSync(gitignore)) ig.add(fs.readFileSync(gitignore, 'utf8'));
  return ig;
}

function isCodeFileName(name: string): boolean {
  return CODE_EXT.test(name) && !name.endsWith('.d.ts');
}

/** True when a project-relative path lies in a folder Mapskill never reads (node_modules anywhere, dist/build/out/public at the root, ...). */
export function isSkippedDir(relDir: string): boolean {
  return relDir.split('/').some((part, i) => SKIP_ANYWHERE.has(part) || (i === 0 && SKIP_AT_ROOT.has(part)));
}

/** Errors that mean "this folder vanished or cannot be read" while walking a tree that may change underneath us. */
const SKIPPABLE_DIR_ERRORS = new Set(['ENOENT', 'EPERM', 'EACCES', 'ENOTDIR']);

export function listSourceFiles(root: string): string[] {
  const ig = loadIgnore(root);
  const out: string[] = [];
  const walk = (dirRel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, dirRel), { withFileTypes: true });
    } catch (err) {
      // A subfolder can vanish (or be locked) mid-walk; skip it. The root itself failing is a real error.
      if (dirRel && SKIPPABLE_DIR_ERRORS.has((err as NodeJS.ErrnoException).code ?? '')) return;
      throw err;
    }
    for (const entry of entries) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_ANYWHERE.has(entry.name) || (!dirRel && SKIP_AT_ROOT.has(entry.name)) || ig.ignores(`${rel}/`)) continue;
        walk(rel);
      } else if (entry.isFile() && isCodeFileName(entry.name) && !ig.ignores(rel)) {
        out.push(rel);
      }
    }
  };
  walk('');
  return out.sort();
}

/** Same rules as listSourceFiles, for one project-relative path that may not exist (yet). */
export function createSourceFilter(root: string): (rel: string) => boolean {
  const ig = loadIgnore(root);
  return (rel) => {
    if (!rel || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return false;
    const parts = rel.split('/');
    if (!isCodeFileName(parts[parts.length - 1])) return false;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join('/');
      if (isSkippedDir(dir) || ig.ignores(`${dir}/`)) return false;
    }
    return !ig.ignores(rel);
  };
}
