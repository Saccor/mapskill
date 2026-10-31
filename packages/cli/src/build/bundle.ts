import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Metafile } from 'esbuild';

export interface BundleReport {
  /** Absolute path of mapskill.mjs. */
  entry: string;
  /** Source files (paths as esbuild reports them, '/' separators) loaded when `mapskill hook` runs. */
  hookClosureInputs: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/** Output files reachable from `start` through static imports only. */
function staticClosure(meta: Metafile, start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const out = queue.pop()!;
    if (seen.has(out)) continue;
    seen.add(out);
    for (const imp of meta.outputs[out]?.imports ?? []) if (imp.kind === 'import-statement' && !imp.external) queue.push(imp.path);
  }
  return seen;
}

/** Bundles the CLI into `outdir`: mapskill.mjs plus chunks/, loadable by plain node without node_modules. */
export async function bundlePlugin(outdirArg: string): Promise<BundleReport> {
  const outdir = path.resolve(outdirArg);
  fs.rmSync(outdir, { recursive: true, force: true });
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: { mapskill: 'packages/cli/src/bin.ts' },
    outdir,
    outExtension: { '.js': '.mjs' },
    chunkNames: 'chunks/[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // ws tries these optional native helpers and works without them.
    external: ['bufferutil', 'utf-8-validate'],
    // Bundled CommonJS (typescript, ws) calls require() for Node built-ins and reads __filename/__dirname; ESM output has none of them.
    banner: {
      js: [
        "import { createRequire as __mapskillCreateRequire } from 'node:module';",
        "import { fileURLToPath as __mapskillFileURLToPath } from 'node:url';",
        "import { dirname as __mapskillDirname } from 'node:path';",
        'const require = __mapskillCreateRequire(import.meta.url);',
        'const __filename = __mapskillFileURLToPath(import.meta.url);',
        'const __dirname = __mapskillDirname(__filename);',
      ].join(' '),
    },
    metafile: true,
    logLevel: 'warning',
  });
  const meta = result.metafile;
  const rel = (p: string): string => path.relative(repoRoot, p).split(path.sep).join('/');
  const entryOut = Object.keys(meta.outputs).find((o) => meta.outputs[o].entryPoint === 'packages/cli/src/bin.ts');
  if (!entryOut) throw new Error('bundle has no entry output');
  // The hook command's chunk: the output that holds hooks/run.ts.
  const hookOut = Object.keys(meta.outputs).find((o) => 'packages/cli/src/hooks/run.ts' in meta.outputs[o].inputs);
  if (!hookOut) throw new Error('bundle has no chunk for the hooks');
  const outputs = new Set([...staticClosure(meta, entryOut), ...staticClosure(meta, hookOut)]);
  const hookClosureInputs = [...outputs].flatMap((o) => Object.keys(meta.outputs[o].inputs)).sort();
  return { entry: path.resolve(repoRoot, entryOut), hookClosureInputs: hookClosureInputs.map((p) => rel(path.resolve(repoRoot, p))) };
}

// `tsx packages/cli/src/build/bundle.ts <outdir>`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outdir = process.argv[2] ?? 'plugin/dist';
  bundlePlugin(outdir).then(
    (r) => process.stdout.write(`Bundled ${r.entry}\n`),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
