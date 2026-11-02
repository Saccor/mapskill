import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePlugin } from './bundle';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const pluginDir = path.join(repoRoot, 'plugin');

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
export async function buildRelease(outRoot: string): Promise<{ packageDir: string; version: string }> {
  const root = path.resolve(outRoot);
  const packageDir = path.join(root, 'mapskill');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });

  await bundlePlugin(path.join(packageDir, 'dist'));

  const { version } = readJson(path.join(repoRoot, 'packages', 'cli', 'package.json'));
  const manifest = readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
  const description = manifest.description as string;
  writeJson(path.join(packageDir, '.claude-plugin', 'plugin.json'), { ...manifest, version });

  for (const name of ['hooks', '.mcp.json', 'skills', 'commands']) {
    const src = path.join(pluginDir, name);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(packageDir, name), { recursive: true });
  }
  fs.copyFileSync(path.join(pluginDir, 'README.en.md'), path.join(packageDir, 'README.md'));
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

  writeJson(path.join(root, '.claude-plugin', 'marketplace.json'), {
    name: 'mapskill-local',
    owner: { name: 'Saccor' },
    description: 'Local test build of Mapskill',
    plugins: [{ name: 'mapskill', source: './mapskill', description }],
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
