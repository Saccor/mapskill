import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface Resolver {
  /** Returns a project-relative path with '/' separators, or null for packages and unresolvable imports. */
  resolve(specifier: string, fromFile: string): string | null;
  /** Set when tsconfig/jsconfig exists but could not be parsed; resolution then uses the default fallback. */
  configError?: string;
  /** Prefixes of tsconfig `paths` keys (e.g. '@/'), used to recognise local-looking specifiers. */
  pathPrefixes: string[];
  /** Forgets cached resolutions. Call after files were added or removed. */
  clearCache(): void;
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

export function loadCompilerOptions(root: string): { options: ts.CompilerOptions; error?: string } {
  let error: string | undefined;
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.join(root, name).split(path.sep).join('/');
    if (!fs.existsSync(file)) continue;
    const read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error) {
      error = ts.flattenDiagnosticMessageText(read.error.messageText, ' ');
      break;
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, file);
    return { options: withDefaults(parsed.options) };
  }
  const target = fs.existsSync(path.join(root, 'src')) ? './src/*' : './*';
  return { options: withDefaults({ baseUrl: root, paths: { '@/*': [target] } }), error };
}

export function createResolver(root: string): Resolver {
  const { options, error } = loadCompilerOptions(root);
  const pathPrefixes = Object.keys(options.paths ?? {}).map((k) => k.replace(/\*$/, '')).filter((k) => k.length > 0);
  const newCache = (): ts.ModuleResolutionCache => ts.createModuleResolutionCache(root, (f) => f, options);
  let cache = newCache();
  return {
    configError: error,
    pathPrefixes,
    clearCache() {
      cache = newCache();
    },
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
