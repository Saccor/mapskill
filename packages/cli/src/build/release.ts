import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePlugin } from './bundle';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const defaultPluginDir = path.join(repoRoot, 'plugin');
/** Written by every build: it marks a folder that is safe to delete and build again. */
const MARKETPLACE = path.join('.claude-plugin', 'marketplace.json');
const MARKETPLACE_NAME = 'mapskill-local';

/** Throws unless `root` is missing, or is a folder named `release` that is empty or holds an earlier build. */
function assertSafeToReplace(root: string): void {
  if (!fs.existsSync(root)) return;
  let earlierBuild = false;
  try {
    earlierBuild = readJson(path.join(root, MARKETPLACE)).name === MARKETPLACE_NAME;
  } catch {
    // no marker
  }
  const empty = fs.statSync(root).isDirectory() && fs.readdirSync(root).length === 0;
  if (path.basename(root) !== 'release' || !(earlierBuild || empty)) {
    throw new Error(`Refusing to delete ${root}: only an empty folder named "release" or an earlier release build is replaced.`);
  }
}

const SHEBANG = '#!/usr/bin/env node';
const MIT = `MIT License

Copyright (c) 2026 Saccor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
}

/** Builds the publishable npm package (which is also the Claude Code plugin root) in `<outRoot>/mapskill`, plus a local test marketplace in `<outRoot>/.claude-plugin`. */
export async function buildRelease(
  outRoot: string,
  options: { pluginDir?: string } = {},
): Promise<{ packageDir: string; version: string }> {
  const pluginDir = options.pluginDir ?? defaultPluginDir;
  const root = path.resolve(outRoot);
  const packageDir = path.join(root, 'mapskill');
  const readme = path.join(pluginDir, 'README.en.md');
  if (!fs.existsSync(readme)) throw new Error(`${readme} is missing: the npm package needs it as its README.md.`);
  assertSafeToReplace(root);
  const { version } = readJson(path.join(repoRoot, 'packages', 'cli', 'package.json'));
  const manifest = readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
  const description = manifest.description as string;
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });
  // The marketplace goes first: it also marks the folder as a build, so a build that fails halfway can be redone.
  writeJson(path.join(root, MARKETPLACE), {
    name: MARKETPLACE_NAME,
    owner: { name: 'Saccor' },
    description: 'Local test build of Mapskill',
    plugins: [{ name: 'mapskill', source: './mapskill', description }],
  });

  await bundlePlugin(path.join(packageDir, 'dist'));

  writeJson(path.join(packageDir, '.claude-plugin', 'plugin.json'), { ...manifest, version });

  for (const name of ['hooks', '.mcp.json', 'skills', 'commands']) {
    const src = path.join(pluginDir, name);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(packageDir, name), { recursive: true });
  }
  fs.copyFileSync(readme, path.join(packageDir, 'README.md'));
  const license = path.join(repoRoot, 'LICENSE');
  if (fs.existsSync(license)) fs.copyFileSync(license, path.join(packageDir, 'LICENSE'));
  else fs.writeFileSync(path.join(packageDir, 'LICENSE'), MIT);

  writeJson(path.join(packageDir, 'package.json'), {
    name: 'mapskill',
    version,
    description,
    license: 'MIT',
    type: 'module',
    bin: { mapskill: 'dist/mapskill.mjs' },
    engines: { node: '>=22.12' },
    files: ['dist', '.claude-plugin', 'hooks', '.mcp.json', 'skills', 'commands', 'README.md', 'LICENSE'],
    keywords: ['claude-code', 'plugin', 'map', 'beginner'],
  });

  const entry = path.join(packageDir, 'dist', 'mapskill.mjs');
  const code = fs.readFileSync(entry, 'utf8');
  if (!code.startsWith(SHEBANG)) fs.writeFileSync(entry, `${SHEBANG}\n${code}`);

  return { packageDir, version };
}

// `tsx packages/cli/src/build/release.ts <outRoot>`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outRoot = process.argv[2] ?? 'release';
  buildRelease(outRoot).then(
    (r) => process.stdout.write(`Built ${r.packageDir} (version ${r.version})\n`),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
