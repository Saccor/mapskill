import pkg from '../package.json' with { type: 'json' };

/** The one place the package version lives: `version` in packages/cli/package.json. */
export const VERSION: string = pkg.version;
