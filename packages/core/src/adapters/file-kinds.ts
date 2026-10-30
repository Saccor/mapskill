import { routeFileInfo } from './nextjs/routes';

const TEST_SUFFIX = /\.(test|spec)\.[cm]?[jt]sx?$/;

export function isTestFile(p: string): boolean {
  if (TEST_SUFFIX.test(p)) return true;
  if (routeFileInfo(p) !== null) return false;
  return /(^|\/)__tests__\//.test(p) || /^(src\/)?(tests?|e2e|cypress)\//.test(p);
}

export function isToolingConfig(p: string): boolean {
  return !p.includes('/') && /\.config\.[cm]?[jt]s$/.test(p);
}
