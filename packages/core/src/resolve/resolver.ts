import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface Resolver {
  /** Returns a project-relative path with '/' separators, or null for packages and unresolvable imports. */
  resolve(specifier: string, fromFile: string): string | null;
}

function withDefaults(o: ts.CompilerOptions): ts.CompilerOptions {
  return {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    ...o,
    module: o.module ?? ts.ModuleKind.ESNext,
    moduleResolution: o.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
  };
}

export function loadCompilerOptions(root: string): ts.CompilerOptions {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error) break;
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, file);
    return withDefaults(parsed.options);
  }
  const target = fs.existsSync(path.join(root, 'src')) ? './src/*' : './*';
  return withDefaults({ baseUrl: root, paths: { '@/*': [target] } });
}

export function createResolver(root: string): Resolver {
  const options = loadCompilerOptions(root);
  const cache = ts.createModuleResolutionCache(root, (f) => f, options);
  return {
    resolve(specifier, fromFile) {
      const containing = path.join(root, fromFile);
      const resolved = ts.resolveModuleName(specifier, containing, options, ts.sys, cache).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) return null;
      const rel = path.relative(root, resolved.resolvedFileName).split(path.sep).join('/');
      if (rel.startsWith('..') || rel.includes('node_modules/') || rel.endsWith('.d.ts')) return null;
      return rel;
    },
  };
}
