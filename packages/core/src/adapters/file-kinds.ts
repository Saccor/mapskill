export function isTestFile(p: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || p.startsWith('tests/') || p.includes('/__tests__/');
}

export function isToolingConfig(p: string): boolean {
  return !p.includes('/') && /\.config\.[cm]?[jt]s$/.test(p);
}
